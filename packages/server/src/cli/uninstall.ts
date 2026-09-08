import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { DEFAULT_CONFIG_FILE, loadConfig } from '../config.js';
import type { Io } from './commands.js';
import { defaultStopDeps, runStop } from './stop.js';

const execFileAsync = promisify(execFile);

export interface UninstallDeps {
  readonly confirm: () => Promise<boolean>;
  readonly stop: (io: Io, home: string) => Promise<0 | 1>;
  readonly killTmuxServer: (confPath: string, socket: string) => Promise<void>;
  readonly removeAppDir: (path: string) => void;
  readonly home: string;
  readonly appDir: string;
  readonly tmuxSocket: string;
}

async function promptConfirm(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      'This stops garden, kills every tmux session it manages, and deletes ~/.garden. Continue? [y/N] ',
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** The documented exception in docs/architecture.md §4.4: uninstall must work with the
 *  garden server dead, so it shells out to tmux directly instead of going through it. */
async function killTmuxServer(confPath: string, socket: string): Promise<void> {
  try {
    await execFileAsync('tmux', ['-L', socket, '-f', confPath, 'kill-server']);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    // No server on this socket means nothing to kill, which is success, not a failure.
    if (/no server running|error connecting to/i.test(stderr)) return;
    throw error;
  }
}

const defaultHome = homedir();
// The file is not read here: uninstall only needs the app dir and socket, both of
// which come from the environment or their defaults, never from config.json.
const defaultConfig = loadConfig(process.env, DEFAULT_CONFIG_FILE, defaultHome);

export const defaultUninstallDeps: UninstallDeps = {
  confirm: promptConfirm,
  stop: (io, home) => runStop(io, { ...defaultStopDeps, home }),
  killTmuxServer,
  removeAppDir: (path) => {
    rmSync(path, { recursive: true, force: true });
  },
  home: defaultHome,
  appDir: defaultConfig.appDir,
  tmuxSocket: defaultConfig.tmuxSocket,
};

/** `garden uninstall` — stop the server, kill the garden tmux server, delete `~/.garden`. */
export async function runUninstall(
  io: Io,
  skipConfirm: boolean,
  deps: UninstallDeps = defaultUninstallDeps,
): Promise<0 | 1> {
  if (!skipConfirm && !(await deps.confirm())) {
    io.stdout.write('aborted\n');
    return 0;
  }

  const stopResult = await deps.stop(io, deps.home);
  if (stopResult !== 0) return stopResult;

  await deps.killTmuxServer(join(deps.appDir, 'tmux.conf'), deps.tmuxSocket);
  deps.removeAppDir(deps.appDir);

  io.stdout.write('garden uninstalled\n');
  return 0;
}
