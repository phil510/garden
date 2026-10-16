// Tracks the vite dev servers `pnpm screenshot` spawns, so they can be stopped later. One file per
// process group: concurrent checkouts never share a file to read-modify-write, and two checkouts
// whose vite ports collide can't overwrite each other's entry.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ViteEntry {
  pgid: number;
  repoRoot: string;
  port: number;
}

export interface RegistryDeps {
  /** process.kill: throws an ESRCH error when nothing is there to signal. */
  kill: (pid: number, signal: NodeJS.Signals) => void;
  exists: (path: string) => boolean;
  /** Command lines of every process currently in the group. */
  groupCommands: (pgid: number) => string[];
}

export const realDeps: RegistryDeps = {
  kill: (pid, signal) => process.kill(pid, signal),
  exists: existsSync,
  groupCommands: (pgid) =>
    execFileSync('ps', ['-A', '-o', 'pgid=,command='], { encoding: 'utf8' })
      .split('\n')
      .flatMap((line) => {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        return match?.[1] === String(pgid) && match[2] !== undefined ? [match[2]] : [];
      }),
};

function entryPath(dir: string, pgid: number): string {
  return join(dir, `${String(pgid)}.json`);
}

export function record(dir: string, entry: ViteEntry): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(entryPath(dir, entry.pgid), JSON.stringify(entry));
}

function readEntries(dir: string): { file: string; entry: ViteEntry | null }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = join(dir, name);
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ViteEntry>;
        const valid =
          typeof parsed.pgid === 'number' &&
          typeof parsed.repoRoot === 'string' &&
          typeof parsed.port === 'number';
        return { file, entry: valid ? (parsed as ViteEntry) : null };
      } catch {
        return { file, entry: null };
      }
    });
}

/** Stops the entry's process group and reports whether it signalled anything. The pgid may have
 *  been reused by an unrelated group since vite died, so nothing is signalled unless a process in
 *  the group still carries this entry's `--port`. Checking the whole group rather than its leader
 *  matters: pnpm can exit while vite lives on in the group. Throws when the outcome is unknown
 *  (`ps` or `kill` failed), so the caller keeps the entry rather than losing the only record. */
function stop(entry: ViteEntry, deps: RegistryDeps): boolean {
  const commands = deps.groupCommands(entry.pgid);
  if (!commands.some((command) => command.includes(`--port ${String(entry.port)}`))) return false;
  try {
    deps.kill(-entry.pgid, 'SIGTERM');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function stopWhere(
  dir: string,
  deps: RegistryDeps,
  matches: (entry: ViteEntry) => boolean,
): ViteEntry[] {
  const stopped: ViteEntry[] = [];
  for (const { file, entry } of readEntries(dir)) {
    if (entry !== null && !matches(entry)) continue;
    try {
      if (entry !== null && stop(entry, deps)) stopped.push(entry);
    } catch {
      continue;
    }
    rmSync(file, { force: true });
  }
  return stopped;
}

/** Stops every recorded vite whose checkout no longer exists. */
export function reap(dir: string, deps: RegistryDeps): ViteEntry[] {
  return stopWhere(dir, deps, (entry) => !deps.exists(entry.repoRoot));
}

/** Stops every recorded vite of one checkout, whatever port: GARDEN_PORT is part of the port hash,
 *  so a checkout can own several. */
export function stopFor(dir: string, repoRoot: string, deps: RegistryDeps): ViteEntry[] {
  return stopWhere(dir, deps, (entry) => entry.repoRoot === repoRoot);
}
