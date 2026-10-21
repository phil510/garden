import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type { HealthPidResult } from './serverProcess.js';

export function parsePid(text: string): number | null {
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** A missing or unparseable pid file means "nothing recorded", not an error. */
export function readPidFile(path: string): number | null {
  try {
    return parsePid(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function writePidFile(path: string, pid: number): void {
  writeFileSync(path, `${String(pid)}\n`, 'utf8');
}

export function removePidFile(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** `kill(pid, 0)` sends no signal; ESRCH means no such process, EPERM means one exists but isn't ours. */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** `garden`: the recorded pid is confirmed to be the server. `stale`: nothing at that pid is
 *  garden (no pid, dead, reused, or nothing listening). `unresponsive`: the process is alive but
 *  `/health` did not answer, which may be a hung garden. */
export type RecordedPidStatus = 'garden' | 'stale' | 'unresponsive';

/** The one check `garden` and `garden stop` share before acting on `server.pid`: a live pid alone
 *  proves nothing, because an unclean shutdown leaves a pid another process can reuse. */
export async function classifyRecordedPid(
  pid: number | null,
  deps: {
    readonly isProcessRunning: (pid: number) => boolean;
    readonly healthPid: (healthUrl: string) => Promise<HealthPidResult>;
  },
  healthUrl: string,
): Promise<RecordedPidStatus> {
  if (pid === null || !deps.isProcessRunning(pid)) return 'stale';
  const reported = await deps.healthPid(healthUrl);
  if (reported === 'no-answer') return 'unresponsive';
  return reported === pid ? 'garden' : 'stale';
}
