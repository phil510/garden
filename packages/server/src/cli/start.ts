import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureConfigFile, loadConfig } from '../config.js';
import { chromeInstalled, openChromeWindow } from './browser.js';
import type { Io } from './commands.js';
import { writeAll } from './io.js';
import {
  classifyRecordedPid,
  isProcessRunning,
  readPidFile,
  writePidFile,
  type PidRecord,
} from './pid.js';
import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  fetchHealthPid,
  spawnServer,
  type HealthPidResult,
  type SpawnResult,
} from './serverProcess.js';

/**
 * The one startup failure with a known shape: the port is already held by something else.
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
  readonly timedOut: boolean;
  readonly timeoutMs: number;
}): string {
  if (/EADDRINUSE/i.test(input.stderr)) {
    return `port ${String(input.port)} is already in use by another process — stop it or change "port" in ${input.configPath}`;
  }
  if (input.timedOut) {
    return `garden server did not become healthy within ${String(input.timeoutMs / 1000)}s`;
  }
  const trimmed = input.stderr.trim().replace(/^garden: /, '');
  return trimmed !== '' ? trimmed : 'garden server failed to start';
}

/** The spawned re-invocation reads this to know to run `main()` instead of the CLI dispatch. */
export const SERVER_PROCESS_ENV = 'GARDEN_SERVER_PROCESS';

/** Passed as an argv flag on the detached spawn below — deliberately not an env var, unlike
 *  `SERVER_PROCESS_ENV`. An env var set here would sit in this server's own `process.env` for
 *  its whole life, and every tmux command it issues afterward inherits that env, seeding it
 *  into the global environment of every session tmux starts from then on — which is exactly
 *  how a garden-managed pane ends up with `main()`'s own markers. Argv doesn't have that
 *  problem: it's read once by `bin/garden.ts` and never copied into a spawned child's own
 *  argv. `pnpm dev` / `pnpm dev:sandbox` never pass this flag, so they run `main()` attached to
 *  the developer's own terminal. */
export const SERVER_DETACHED_FLAG = '--detached';

export interface StartDeps {
  readonly readPid: (path: string) => PidRecord | null;
  readonly writePid: (path: string, pid: number, port: number) => void;
  readonly isProcessRunning: (pid: number) => boolean;
  readonly healthPid: (healthUrl: string) => Promise<HealthPidResult>;
  readonly spawnServer: (
    scriptPath: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    healthUrl: string,
  ) => Promise<SpawnResult>;
  readonly chromeInstalled: () => boolean;
  readonly openChromeWindow: (url: string) => Promise<void>;
  readonly scriptPath: string;
  readonly home: string;
}

export const defaultStartDeps: StartDeps = {
  readPid: readPidFile,
  writePid: writePidFile,
  isProcessRunning,
  healthPid: fetchHealthPid,
  spawnServer,
  chromeInstalled: () => chromeInstalled(),
  openChromeWindow,
  scriptPath: process.argv[1] ?? '',
  home: homedir(),
};

/** `garden` — start the server if needed, then open the browser window. */
export async function runStart(io: Io, deps: StartDeps = defaultStartDeps): Promise<0 | 1> {
  const config = loadConfig(process.env, ensureConfigFile(deps.home), deps.home);
  const pidPath = join(config.appDir, 'server.pid');
  const existing = deps.readPid(pidPath);
  // The running server keeps the port it started on even if config.json has changed since.
  const runningPort = existing?.port ?? config.port;

  // Attach only to a confirmed garden. A live pid that isn't one (reused after an unclean
  // shutdown) or that doesn't answer leads to a fresh start, which overwrites the pid file.
  const attachStatus = await classifyRecordedPid(
    existing?.pid ?? null,
    deps,
    `http://${config.host}:${String(runningPort)}/health`,
  );
  let port = runningPort;
  if (attachStatus !== 'garden') {
    port = config.port;
    const healthUrl = `http://${config.host}:${String(port)}/health`;
    const result = await deps.spawnServer(
      deps.scriptPath,
      [SERVER_DETACHED_FLAG],
      { ...process.env, [SERVER_PROCESS_ENV]: '1' },
      healthUrl,
    );
    if (result.kind !== 'ready') {
      const configPath = join(config.appDir, 'config.json');
      await writeAll(
        io.stderr,
        `garden: ${describeStartupFailure({
          port: config.port,
          configPath,
          stderr: result.stderr,
          timedOut: result.kind === 'timed-out',
          timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
        })}\n`,
      );
      return 1;
    }
    deps.writePid(pidPath, result.pid, port);
  }

  const url = `http://${config.host}:${String(port)}`;
  if (deps.chromeInstalled()) {
    await deps.openChromeWindow(url);
  } else {
    await writeAll(io.stdout, `${url}\n`);
  }
  return 0;
}
