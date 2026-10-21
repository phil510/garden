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
    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch (error) {
      // A dangling symlink, a symlink to a file, or a folder removed since the listing above:
      // one unlistable entry must not take down every other project's transcripts.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw error;
    }
    for (const entry of entries) {
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
 * The returned `signature` is the `stat()` taken here, before anything is read, so a write
 * landing after this call only makes it stale — never ahead of what was actually parsed.
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

/** How often the live transcript paths are polled for a changed signature. */
export const POLL_MS = 1_000;

/** How often the reconciliation scan looks for files garden doesn't know are live. */
export const RECONCILE_MS = 10_000;

/** How long a live path may go unchanged before the poll stops stat-ing it. The reconciliation
 *  scan promotes it back the next time it finds the file changed. */
export const LIVE_IDLE_MS = 5 * 60_000;

export interface TranscriptSignature {
  size: number;
  mtimeMs: number;
}

/**
 * Diffs a fresh listing of in-scope transcript files against `signatures` and invokes
 * `onStale` for any path that's new or changed. `onStale` owns recording its own success in
 * `signatures`, shared with the live-path poll, so the cache reflects whichever path last read
 * a file. A vanished-file stat (`ENOENT`) is silent; any other stat failure is logged.
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
  /** Marks a transcript path live, or refreshes its idle clock. Synchronous and I/O-free: it
   *  runs on every hook. A path outside `<transcriptsDir>/<in-scope slug>/<name>.jsonl` is
   *  ignored. */
  track(path: string): void;
  close(): Promise<void>;
}

export interface TranscriptTiming {
  pollMs?: number;
  reconcileMs?: number;
  liveIdleMs?: number;
}

export interface Transcripts {
  listFiles(): Promise<string[]>;
  readRecord(path: string): Promise<TranscriptParse>;
  watch(
    onEvent: (event: Extract<GardenEvent, { type: 'transcript-changed' }>) => void,
  ): TranscriptWatcher;
}

/**
 * Reads transcripts and keeps their records current without native file watching, whose
 * cost grows with the corpus. `watch` polls the live set — paths `track` was told about —
 * every `pollMs`, rereading a file only when its `(size, mtimeMs)` changes, and runs the
 * reconciliation scan every `reconcileMs` to discover files nobody announced. A file the scan
 * finds changed joins the live set; a live path unchanged for `liveIdleMs` leaves it.
 *
 * `readRecord` and the watcher share one signature map, so boot replay's reads are what make
 * the first reconciliation tick incremental. An unparseable line is logged once per file.
 */
export function createTranscripts(
  transcriptsDir: string,
  roots: readonly string[],
  logger: TranscriptLogger,
  timing: TranscriptTiming = {},
): Transcripts {
  const { pollMs = POLL_MS, reconcileMs = RECONCILE_MS, liveIdleMs = LIVE_IDLE_MS } = timing;
  const signatures = new Map<string, TranscriptSignature>();

  return {
    listFiles: () => listTranscriptFiles(transcriptsDir, roots),
    async readRecord(path) {
      const { signature, ...parsed } = await readTranscriptRecord(path);
      signatures.set(path, signature);
      return parsed;
    },
    watch(onEvent) {
      const warnedFiles = new Set<string>();
      let warnedOutside = false;
      /** Live path → last time it was tracked or seen changed. */
      const live = new Map<string, number>();

      // The signature is the one readTranscriptRecord stamped the read with, taken before the
      // read, and it is recorded before dispatching: a write landing mid-read only makes it stale,
      // and a throwing `onEvent` can't skip it. A failed read records nothing, so a later tick
      // retries.
      async function reread(path: string): Promise<void> {
        let parsed: TranscriptParse & { signature: TranscriptSignature };
        try {
          parsed = await readTranscriptRecord(path);
        } catch (error) {
          logger.error(`failed to read transcript ${path}: ${(error as Error).message}`);
          return;
        }
        const { record, skipped, signature } = parsed;
        signatures.set(path, signature);
        if (skipped > 0 && !warnedFiles.has(path)) {
          warnedFiles.add(path);
          logger.warn(`skipped ${skipped} unparseable line(s) in ${path}`);
        }
        onEvent({ type: 'transcript-changed', path, record });
      }

      async function pollLive(): Promise<void> {
        for (const path of [...live.keys()]) {
          const now = Date.now();
          if (now - live.get(path)! >= liveIdleMs) {
            live.delete(path);
            continue;
          }
          let size: number;
          let mtimeMs: number;
          try {
            ({ size, mtimeMs } = await stat(path));
          } catch (error) {
            // A session reports its transcript path before the file exists.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              logger.error(`failed to stat transcript ${path}: ${(error as Error).message}`);
            }
            continue;
          }
          const known = signatures.get(path);
          if (known && known.size === size && known.mtimeMs === mtimeMs) continue;
          live.set(path, now);
          await reread(path);
        }
      }

      async function reconcile(): Promise<void> {
        await reconcileTranscripts(
          transcriptsDir,
          roots,
          signatures,
          async (path) => {
            live.set(path, Date.now());
            await reread(path);
          },
          logger,
        );
      }

      // Holds the in-flight tick's promise, not just a boolean: close() awaits it, so a tick
      // already running when close() is called finishes its dispatches before close() resolves.
      // A tick still running when the next is due is skipped rather than queued.
      function singleFlight(name: string, tick: () => Promise<void>) {
        let running: Promise<void> | undefined;
        const start = () => {
          running ??= tick()
            .catch((error: unknown) => {
              logger.error(
                `transcript ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            })
            .finally(() => {
              running = undefined;
            });
        };
        return { start, settled: () => running };
      }

      const pollTick = singleFlight('poll', pollLive);
      const reconcileTick = singleFlight('reconciliation', reconcile);
      const pollTimer = setInterval(pollTick.start, pollMs);
      const reconcileTimer = setInterval(reconcileTick.start, reconcileMs);

      return {
        track(path) {
          const segments = relative(transcriptsDir, path).split(sep);
          if (segments[0] === '..' || segments[0] === '') {
            if (!warnedOutside) {
              warnedOutside = true;
              logger.warn(`ignoring transcript path outside ${transcriptsDir}: ${path}`);
            }
            return;
          }
          const [dir, name] = segments;
          if (
            segments.length !== 2 ||
            !name!.endsWith('.jsonl') ||
            inScopeDirs([dir!], roots).length === 0
          )
            return;
          live.set(join(transcriptsDir, dir!, name!), Date.now());
        },
        async close() {
          clearInterval(pollTimer);
          clearInterval(reconcileTimer);
          await Promise.all([pollTick.settled(), reconcileTick.settled()]);
        },
      };
    },
  };
}
