import { watch } from 'chokidar';
import { mkdirSync } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { inScopeDirs } from '../domain/slug.js';
import { parseTranscript } from '../domain/transcript.js';
import type { TranscriptParse } from '../domain/transcript.js';
import type { GardenEvent } from '../domain/types.js';

/** The slice of `Logger` this adapter needs, declared locally rather than imported —
 *  one adapter per external system, composed together only in main.ts. */
export interface TranscriptLogger {
  warn(message: string): void;
  error(message: string): void;
}

/** Large enough to hold many lines of an ordinary conversation, small enough that
 *  a multi-megabyte transcript is never read whole. */
export const WINDOW_BYTES = 64 * 1024;

/** Every in-scope `*.jsonl` path under `<transcriptsDir>/<slug>/`, one level deep. */
export async function listTranscriptFiles(
  transcriptsDir: string,
  roots: readonly string[],
): Promise<string[]> {
  let dirNames: string[];
  try {
    dirNames = await readdir(transcriptsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const dir of inScopeDirs(dirNames, roots)) {
    const dirPath = join(transcriptsDir, dir);
    for (const entry of await readdir(dirPath)) {
      if (entry.endsWith('.jsonl')) files.push(join(dirPath, entry));
    }
  }
  return files;
}

async function readWindow(path: string, position: number, length: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read({ buffer, position, length });
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Reads a bounded head and a bounded tail of a transcript file and hands the complete
 * lines within each to the pure parser. The window boundary can fall mid-line, so the
 * first line of the tail read and the last line of the head read are each discarded as
 * possibly cut off — a single line longer than a window is dropped entirely, which is
 * why a returned record can be missing a title or a recap without that being an error.
 *
 * The returned `signature` is the `stat()` taken here, before anything is read, so it is
 * always a valid lower bound on what the parse below actually saw: a write landing after
 * this call only makes the cached signature stale (one harmless extra re-read later), never
 * ahead of the dispatched content.
 */
export async function readTranscriptRecord(
  path: string,
  windowBytes = WINDOW_BYTES,
): Promise<TranscriptParse & { signature: TranscriptSignature }> {
  const { size, mtimeMs } = await stat(path);
  const signature: TranscriptSignature = { size, mtimeMs };
  const tailStart = Math.max(0, size - windowBytes);
  // The two windows would overlap once the whole file fits in either one, so read it
  // once instead: every line is then known complete and nothing needs discarding.
  if (tailStart <= windowBytes) {
    return { ...parseTranscript(await readFile(path, 'utf8')), signature };
  }
  const headText = await readWindow(path, 0, windowBytes);
  const tailText = await readWindow(path, tailStart, size - tailStart);
  const headLines = headText.split('\n').slice(0, -1);
  const tailLines = tailText.split('\n').slice(1);
  return { ...parseTranscript([...headLines, ...tailLines].join('\n')), signature };
}

/** Coalesces the run of writes one turn produces on disk into a single re-read. */
export const DEBOUNCE_MS = 200;

/** How often the reconciliation backstop rescans for files the native watch missed. */
export const RECONCILE_MS = 10_000;

export interface TranscriptSignature {
  size: number;
  mtimeMs: number;
}

/**
 * Collapses repeated `schedule(key)` calls into a single `run(key)` once `debounceMs`
 * has passed with no further call for that key — restarting the wait on every call,
 * like `watchTranscripts`'s own re-read debounce. Kept as pure `setTimeout` bookkeeping,
 * decoupled from chokidar, so it can be proven deterministically with fake timers rather
 * than by racing real filesystem delivery (`docs/testing.md` reserves that for the
 * chokidar-timing path itself, which this isn't).
 */
export function createCoalescer(run: (key: string) => void, debounceMs: number) {
  const timers = new Map<string, NodeJS.Timeout>();
  return {
    schedule(key: string): void {
      const existing = timers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          run(key);
        }, debounceMs),
      );
    },
    clear(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

/**
 * Diffs a fresh listing of in-scope transcript files against `signatures` and invokes
 * `onStale` for any path that's new or whose `(size, mtimeMs)` no longer matches what was
 * last cached — the reconciliation backstop for whatever the native watch missed (chokidar
 * scans a newly created directory before it registers that directory's own watch handle, so
 * a rapid write can land in that gap and never produce a native event again). `signatures` is
 * shared with the native watch path, and `onStale` owns recording its own success there — this
 * function only decides whether to call it — so the cache reflects whichever path last read a
 * file, not only this backstop's own reads. A `stat` failure is isolated per file, the same
 * way `reread()` isolates its own per-file read failures: `ENOENT` (vanished between the
 * listing and this stat — session cleanup, a rename) is expected and silent, anything else is
 * logged so a file that persistently fails to stat for another reason doesn't go stale forever
 * with no trace.
 */
export async function reconcileTranscripts(
  transcriptsDir: string,
  roots: readonly string[],
  signatures: Map<string, TranscriptSignature>,
  onStale: (path: string) => Promise<void>,
  logger: TranscriptLogger,
): Promise<void> {
  for (const path of await listTranscriptFiles(transcriptsDir, roots)) {
    let size: number;
    let mtimeMs: number;
    try {
      ({ size, mtimeMs } = await stat(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(
          `failed to stat transcript ${path} during reconciliation: ${(error as Error).message}`,
        );
      }
      continue;
    }
    const known = signatures.get(path);
    if (known && known.size === size && known.mtimeMs === mtimeMs) continue;
    await onStale(path);
  }
}

export interface TranscriptWatcher {
  close(): Promise<void>;
}

/**
 * A path is watched when it is the transcripts directory itself, an in-scope slug directory,
 * or a `.jsonl` file directly inside one. Everything else — a slug directory out of scope,
 * or a session's own subdirectory holding `subagents/` two levels deeper — is ignored, which
 * also stops chokidar recursing into it: a subagent file carries its parent session's id, so
 * reading one would corrupt the parent's record.
 */
function isWatchedPath(transcriptsDir: string, roots: readonly string[], path: string): boolean {
  const rel = relative(transcriptsDir, path);
  if (rel === '') return true;
  const segments = rel.split(sep);
  if (segments.length === 1) return inScopeDirs([segments[0]!], roots).length > 0;
  if (segments.length === 2)
    return segments[1]!.endsWith('.jsonl') && inScopeDirs([segments[0]!], roots).length > 0;
  return false;
}

/**
 * Watches every in-scope `<slug>/*.jsonl` file and emits a debounced `transcript-changed`
 * event per file, re-reading it with `readTranscriptRecord`. An unparseable line is logged
 * once per file — the first time it is seen, not on every subsequent re-read.
 */
export function watchTranscripts(
  transcriptsDir: string,
  roots: readonly string[],
  onEvent: (event: Extract<GardenEvent, { type: 'transcript-changed' }>) => void,
  logger: TranscriptLogger,
  debounceMs = DEBOUNCE_MS,
  reconcileMs = RECONCILE_MS,
): TranscriptWatcher {
  // fs.watch needs the directory to already exist; Claude Code creates it on first
  // use, but a garden started before that has nothing to attach a watch to otherwise.
  mkdirSync(transcriptsDir, { recursive: true });
  const warnedFiles = new Set<string>();
  const signatures = new Map<string, TranscriptSignature>();

  // Every successful read records its own signature, regardless of which path (native watch
  // or reconciliation) triggered it, so the two share one accurate cache instead of only
  // reconciliation's own reads being remembered. The signature cached is the one
  // readTranscriptRecord stamped the read with — taken before the read, never a fresh stat
  // taken after dispatch — so it can only be behind what was actually read, never ahead of
  // it; a failed read caches nothing, so it's retried on the next reconciliation pass.
  async function reread(path: string): Promise<void> {
    let parsed: TranscriptParse & { signature: TranscriptSignature };
    try {
      parsed = await readTranscriptRecord(path);
    } catch (error) {
      logger.error(`failed to read transcript ${path}: ${(error as Error).message}`);
      return;
    }
    const { record, skipped, signature } = parsed;
    if (skipped > 0 && !warnedFiles.has(path)) {
      warnedFiles.add(path);
      logger.warn(`skipped ${skipped} unparseable line(s) in ${path}`);
    }
    onEvent({ type: 'transcript-changed', path, record });
    signatures.set(path, signature);
  }

  const coalescer = createCoalescer((path) => void reread(path), debounceMs);

  const watcher = watch(transcriptsDir, {
    ignored: (path) => !isWatchedPath(transcriptsDir, roots, path),
  });
  watcher.on('add', (path) => coalescer.schedule(path));
  watcher.on('change', (path) => coalescer.schedule(path));
  // Otherwise silent: an EMFILE under fd pressure produces the same "ready, then no more
  // events" signature as the missed-directory-watch gap the backstop below covers.
  watcher.on('error', (error) => {
    logger.error(`transcript watcher error: ${(error as Error).message}`);
  });

  // Holds the in-flight tick's promise, not just a boolean: close() awaits it below, so a
  // reconciliation already running when close() is called finishes its dispatches before
  // close() resolves, rather than racing a dispatch against a closed watcher.
  let reconciling: Promise<void> | undefined;
  function runReconciliationTick(): Promise<void> {
    // Skips this tick rather than queuing — a slow reconciliation pass (many files, a
    // contended disk) should never stack a second one behind it.
    if (reconciling) return reconciling;
    reconciling = reconcileTranscripts(transcriptsDir, roots, signatures, reread, logger)
      .catch((error: unknown) => {
        logger.error(
          `transcript reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        reconciling = undefined;
      });
    return reconciling;
  }
  const reconcileTimer = setInterval(() => void runReconciliationTick(), reconcileMs);

  return {
    close: async () => {
      clearInterval(reconcileTimer);
      // Closing the watcher first removes its listeners synchronously (chokidar's own
      // close() calls removeAllListeners() before doing anything async), so an event that
      // arrives during the awaits below can't schedule a fresh coalescer timer that would
      // otherwise fire — and dispatch — after this function has already resolved.
      await watcher.close();
      coalescer.clear();
      await reconciling;
    },
  };
}
