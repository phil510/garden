import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface RegistryEntry {
  sessionId: string;
  name: string;
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string' &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

export interface ClaudeSessionNamesResult {
  names: Record<string, string>;
  /** Registry files that named no session — unparseable JSON, or valid JSON missing
   *  `sessionId`/`name`. Mirrors `transcripts.ts`'s skipped-count convention: the read
   *  reports the count and the caller decides whether and how to log it. */
  skipped: number;
}

/**
 * Reads every `*.json` file in the Claude session registry and returns the session id to
 * Claude-side name map it describes. The registry is keyed by pid on disk, but garden's
 * `SessionState` carries no pid, so this scans every file and matches by `sessionId` — the
 * same approach `message-session`'s `resolve_session.sh` takes against the same directory.
 * A missing directory resolves to an empty map, matching `listTranscriptFiles`'s ENOENT
 * convention. A single malformed file names no session rather than failing the whole read, so
 * one bad registry entry does not blank out every session's identity.
 *
 * A registry entry can outlive its process (an unclean kill leaves its file behind until
 * cleanup runs), so two files can legitimately name the same `sessionId` — a lingering dead
 * entry and a fresh resume. `resolve_session.sh` treats that as ambiguous and resolves
 * nothing rather than guessing by recency; this scan does the same, dropping the name for a
 * `sessionId` seen more than once so the session degrades to its bare id instead of risking a
 * stale display.
 */
export async function readClaudeSessionNames(
  sessionsDir: string,
): Promise<ClaudeSessionNamesResult> {
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { names: {}, skipped: 0 };
    throw error;
  }
  const names: Record<string, string> = {};
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(sessionsDir, entry), 'utf8'));
      if (!isRegistryEntry(parsed)) {
        skipped += 1;
        continue;
      }
      if (seen.has(parsed.sessionId)) {
        delete names[parsed.sessionId];
        continue;
      }
      seen.add(parsed.sessionId);
      names[parsed.sessionId] = parsed.name;
    } catch {
      skipped += 1;
    }
  }
  return { names, skipped };
}
