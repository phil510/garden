import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureConfigFile, loadConfig } from '../config.js';
import { chromeInstalled, openChromeWindow } from './browser.js';
import type { Io } from './commands.js';
import { isProcessRunning, readPidFile, writePidFile } from './pid.js';
import { checkTmux, type PreflightResult } from './preflight.js';
import { spawnServer, type SpawnResult } from './serverProcess.js';

export type PidStatus = 'running' | 'not-running';

/** Whether to reuse the server a recorded pid names, or start a fresh one. */
export function decideStartupAction(pid: PidStatus): 'attach' | 'start' {
  return pid === 'running' ? 'attach' : 'start';
}

/**
 * The one failure the spec names by shape: the port is already held by something else.
 *
 * Never returns a "garden: "-prefixed string — `runStart` owns that prefix. The child
 * process (`bin/garden.ts`'s `runServer`) writes its own `garden: <message>` to stderr
 * when it exits on a thrown startup error, so a leading prefix here is stripped rather
 * than relayed, or the caller's own prefix would double up.
 */
export function describeStartupFailure(input: {
  readonly port: number;
  readonly configPath: string;
  readonly stderr: string;
}): string {
  if (/EADDRINUSE/i.test(input.stderr)) {
    return `port ${String(input.port)} is already in use by another process — stop it or change "port" in ${input.configPath}`;
  }
  const trimmed = input.stderr.trim().replace(/^garden: /, '');
  return trimmed !== '' ? trimmed : 'garden server failed to start';
}

/** The spawned re-invocation reads this to know to run `main()` instead of the CLI dispatch. */
export const SERVER_PROCESS_ENV = 'GARDEN_SERVER_PROCESS';

export interface StartDeps {
  readonly checkTmux: () => Promise<PreflightResult>;
  readonly readPid: (path: string) => number | null;
  readonly writePid: (path: string, pid: number) => void;
  readonly isProcessRunning: (pid: number) => boolean;
  readonly spawnServer: (
    scriptPath: string,
    env: NodeJS.ProcessEnv,
    healthUrl: string,
  ) => Promise<SpawnResult>;
  readonly chromeInstalled: () => boolean;
  readonly openChromeWindow: (url: string) => Promise<void>;
  readonly scriptPath: string;
  readonly home: string;
}

export const defaultStartDeps: StartDeps = {
  checkTmux,
  readPid: readPidFile,
  writePid: writePidFile,
  isProcessRunning,
  spawnServer,
  chromeInstalled: () => chromeInstalled(),
  openChromeWindow,
  scriptPath: process.argv[1] ?? '',
  home: homedir(),
};

/** `garden` — start the server if needed, then open the browser window. */
export async function runStart(io: Io, deps: StartDeps = defaultStartDeps): Promise<0 | 1> {
  const preflight = await deps.checkTmux();
  if (!preflight.ok) {
    io.stderr.write(`garden: ${preflight.message}\n`);
    return 1;
  }

  const config = loadConfig(process.env, ensureConfigFile(deps.home), deps.home);
  const pidPath = join(config.appDir, 'server.pid');
  const existingPid = deps.readPid(pidPath);
  const status: PidStatus =
    existingPid !== null && deps.isProcessRunning(existingPid) ? 'running' : 'not-running';

  if (decideStartupAction(status) === 'start') {
    const healthUrl = `http://${config.host}:${String(config.port)}/health`;
    const result = await deps.spawnServer(
      deps.scriptPath,
      { ...process.env, [SERVER_PROCESS_ENV]: '1' },
      healthUrl,
    );
    if (result.kind !== 'ready') {
      const configPath = join(config.appDir, 'config.json');
      io.stderr.write(
        `garden: ${describeStartupFailure({ port: config.port, configPath, stderr: result.stderr })}\n`,
      );
      return 1;
    }
    deps.writePid(pidPath, result.pid);
  }

  const url = `http://${config.host}:${String(config.port)}`;
  if (deps.chromeInstalled()) {
    await deps.openChromeWindow(url);
  } else {
    io.stdout.write(`${url}\n`);
  }
  return 0;
}
