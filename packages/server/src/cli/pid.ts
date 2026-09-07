import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

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
