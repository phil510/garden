import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureConfigFile, loadConfig } from '../config.js';
import type { Io } from './commands.js';
import { isProcessRunning, readPidFile, removePidFile } from './pid.js';

export interface StopDeps {
  readonly readPid: (path: string) => number | null;
  readonly removePid: (path: string) => void;
  readonly isProcessRunning: (pid: number) => boolean;
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
  readonly home: string;
  readonly stopTimeoutMs: number;
  readonly pollIntervalMs: number;
}

export const defaultStopDeps: StopDeps = {
  readPid: readPidFile,
  removePid: removePidFile,
  isProcessRunning,
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
  home: homedir(),
  stopTimeoutMs: 5000,
  pollIntervalMs: 50,
};

/** `garden stop` — stop the server. tmux and sessions are untouched. */
export async function runStop(io: Io, deps: StopDeps = defaultStopDeps): Promise<0 | 1> {
  const config = loadConfig(process.env, ensureConfigFile(deps.home), deps.home);
  const pidPath = join(config.appDir, 'server.pid');
  const pid = deps.readPid(pidPath);

  if (pid === null || !deps.isProcessRunning(pid)) {
    // A recorded pid that is no longer running is stale bookkeeping, not a running server.
    deps.removePid(pidPath);
    io.stdout.write('garden is not running\n');
    return 0;
  }

  deps.kill(pid, 'SIGTERM');
  const deadline = Date.now() + deps.stopTimeoutMs;
  while (deps.isProcessRunning(pid)) {
    if (Date.now() >= deadline) {
      io.stderr.write(
        `garden: server (pid ${String(pid)}) did not stop within ${String(deps.stopTimeoutMs)}ms\n`,
      );
      return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, deps.pollIntervalMs));
  }

  deps.removePid(pidPath);
  io.stdout.write('garden stopped\n');
  return 0;
}
