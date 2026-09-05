import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { inScopeDirs } from '../domain/slug.js';
import { parseTranscript } from '../domain/transcript.js';
import type { TranscriptParse } from '../domain/transcript.js';

/** A 10 MB transcript can be 329 lines, so a window this size holds many lines
 *  of ordinary conversation while staying far cheaper than a full read. */
export const WINDOW_BYTES = 64 * 1024;

/** Every in-scope `*.jsonl` path under `~/.claude/projects/<slug>/`, one level deep. */
export async function listTranscriptFiles(
  home: string,
  roots: readonly string[],
): Promise<string[]> {
  const projectsDir = join(home, '.claude', 'projects');
  let dirNames: string[];
  try {
    dirNames = await readdir(projectsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const dir of inScopeDirs(dirNames, roots)) {
    const dirPath = join(projectsDir, dir);
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
