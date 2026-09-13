import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DEFAULT_CONFIG_FILE, ensureConfigFile, loadConfig } from '../config.js';
import type { CliClient, Io } from './commands.js';
import { defaultClient } from './commands.js';
import { CliHttpError } from './http.js';
import { writeAll } from './io.js';
import { isProcessRunning, readPidFile, removePidFile } from './pid.js';
import { killTmuxServer } from './tmux.js';

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
    await writeAll(io.stdout, 'garden is not running\n');
    return 0;
  }

  deps.kill(pid, 'SIGTERM');
  const deadline = Date.now() + deps.stopTimeoutMs;
  while (deps.isProcessRunning(pid)) {
    if (Date.now() >= deadline) {
      await writeAll(
        io.stderr,
        `garden: server (pid ${String(pid)}) did not stop within ${String(deps.stopTimeoutMs)}ms\n`,
      );
      return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, deps.pollIntervalMs));
  }

  deps.removePid(pidPath);
  await writeAll(io.stdout, 'garden stopped\n');
  return 0;
}

export interface StopAllDeps {
  readonly confirm: (message: string) => Promise<boolean>;
  readonly stop: (io: Io, home: string) => Promise<0 | 1>;
  readonly killTmuxServer: (confPath: string, socket: string) => Promise<void>;
  readonly home: string;
  readonly appDir: string;
  readonly tmuxSocket: string;
}

async function promptConfirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(message);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

const defaultHome = homedir();
// The file is not read here: stop --all only needs the app dir and socket, both of which
// come from the environment or their defaults, never from config.json.
const defaultConfig = loadConfig(process.env, DEFAULT_CONFIG_FILE, defaultHome);

export const defaultStopAllDeps: StopAllDeps = {
  confirm: promptConfirm,
  stop: (io, home) => runStop(io, { ...defaultStopDeps, home }),
  killTmuxServer,
  home: defaultHome,
  appDir: defaultConfig.appDir,
  tmuxSocket: defaultConfig.tmuxSocket,
};

/** The server answers with `/sessions` while it's still up; once it's stopped there's nothing
 *  to ask. `null` means the server was unreachable, not that the count is zero. */
async function liveSessionCount(client: CliClient): Promise<number | null> {
  try {
    const { sessions } = await client.listSessions();
    return sessions.filter((s) => s.liveness === 'live').length;
  } catch (error) {
    if (error instanceof CliHttpError) return null;
    throw error;
  }
}

function confirmMessage(liveCount: number | null): string {
  // Built as a possessive already, since "session's" (singular) and "sessions'" (plural)
  // take the apostrophe in different places — a suffix appended after the fact can't do both.
  const sessionsPossessive =
    liveCount === null
      ? "an uncounted number of live sessions'"
      : liveCount === 1
        ? "1 live session's"
        : `${String(liveCount)} live sessions'`;
  return (
    `This stops garden and kills every tmux session it manages, losing ${sessionsPossessive} ` +
    `in-flight Claude work. ~/.garden is kept. Continue? [y/N] `
  );
}

/** `garden stop --all` — stop the server, then kill the garden tmux server. Unlike plain
 *  `garden stop`, this is a hard stop: every session's in-flight Claude work is lost. */
export async function runStopAll(
  io: Io,
  skipConfirm: boolean,
  client: CliClient = defaultClient,
  deps: StopAllDeps = defaultStopAllDeps,
): Promise<0 | 1> {
  if (!skipConfirm) {
    const liveCount = await liveSessionCount(client);
    if (!(await deps.confirm(confirmMessage(liveCount)))) {
      await writeAll(io.stdout, 'aborted\n');
      return 0;
    }
  }

  const stopResult = await deps.stop(io, deps.home);
  if (stopResult !== 0) return stopResult;

  await deps.killTmuxServer(join(deps.appDir, 'tmux.conf'), deps.tmuxSocket);
  await writeAll(io.stdout, 'garden stopped; tmux server killed\n');
  return 0;
}
