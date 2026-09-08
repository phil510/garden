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
 */
export async function readTranscriptRecord(
  path: string,
  windowBytes = WINDOW_BYTES,
): Promise<TranscriptParse> {
  const { size } = await stat(path);
  const tailStart = Math.max(0, size - windowBytes);
  // The two windows would overlap once the whole file fits in either one, so read it
  // once instead: every line is then known complete and nothing needs discarding.
  if (tailStart <= windowBytes) {
    return parseTranscript(await readFile(path, 'utf8'));
  }
  const headText = await readWindow(path, 0, windowBytes);
  const tailText = await readWindow(path, tailStart, size - tailStart);
  const headLines = headText.split('\n').slice(0, -1);
  const tailLines = tailText.split('\n').slice(1);
  return parseTranscript([...headLines, ...tailLines].join('\n'));
}

/** Coalesces the run of writes one turn produces on disk into a single re-read. */
export const DEBOUNCE_MS = 200;

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
): TranscriptWatcher {
  // fs.watch needs the directory to already exist; Claude Code creates it on first
  // use, but a garden started before that has nothing to attach a watch to otherwise.
  mkdirSync(transcriptsDir, { recursive: true });
  const timers = new Map<string, NodeJS.Timeout>();
  const warnedFiles = new Set<string>();

  async function reread(path: string): Promise<void> {
    timers.delete(path);
    let parsed: TranscriptParse;
    try {
      parsed = await readTranscriptRecord(path);
    } catch (error) {
      logger.error(`failed to read transcript ${path}: ${(error as Error).message}`);
      return;
    }
    const { record, skipped } = parsed;
    if (skipped > 0 && !warnedFiles.has(path)) {
      warnedFiles.add(path);
      logger.warn(`skipped ${skipped} unparseable line(s) in ${path}`);
    }
    onEvent({ type: 'transcript-changed', path, record });
  }

  function scheduleReread(path: string): void {
    const existing = timers.get(path);
    if (existing !== undefined) clearTimeout(existing);
    timers.set(
      path,
      setTimeout(() => void reread(path), debounceMs),
    );
  }

  const watcher = watch(transcriptsDir, {
    ignored: (path) => !isWatchedPath(transcriptsDir, roots, path),
  });
  watcher.on('add', scheduleReread);
  watcher.on('change', scheduleReread);

  return {
    close: async () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await watcher.close();
    },
  };
}
