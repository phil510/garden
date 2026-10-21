import { spawn } from 'node:child_process';

export type SpawnResult =
  | { readonly kind: 'ready'; readonly pid: number }
  | { readonly kind: 'exited'; readonly code: number | null; readonly stderr: string }
  | { readonly kind: 'timed-out'; readonly stderr: string; readonly pid: number | undefined };

const POLL_INTERVAL_MS = 50;

/** Default readiness timeout for `spawnServer`. `describeStartupFailure` (in `start.ts`) names
 *  this same value in its timed-out message, so the two never drift apart. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;

/** What `/health` told us about the process behind a port: the pid it reported, that nothing is
 *  listening (`refused`), or that something is but did not answer usefully (`no-answer`). */
export type HealthPidResult = number | 'refused' | 'no-answer';

/** The server's main thread can block during session spawns, so too short a timeout misreads a
 *  busy healthy garden as hung; with none at all, a hung garden would hang `garden stop`. */
const HEALTH_PID_TIMEOUT_MS = 2500;

export async function fetchHealthPid(
  healthUrl: string,
  timeoutMs = HEALTH_PID_TIMEOUT_MS,
): Promise<HealthPidResult> {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return 'no-answer';
    const body = (await response.json()) as { pid?: unknown };
    return typeof body.pid === 'number' ? body.pid : 'no-answer';
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code === 'ECONNREFUSED' ? 'refused' : 'no-answer';
  }
}

/**
 * Spawns `scriptPath` as a detached background process — this is how `garden` daemonises
 * itself, re-invoking its own entry point with `env` carrying the marker that routes it to
 * `main()` instead of back through the CLI dispatch, plus `args` (e.g. `SERVER_DETACHED_FLAG`)
 * appended to its argv — and polls `healthUrl` until it reports the child's pid or `timeoutMs` passes. The
 * child is left running only in the "ready" case; every other outcome kills it rather than
 * leaking an unmanaged process.
 */
export async function spawnServer(
  scriptPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  healthUrl: string,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<SpawnResult> {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env,
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  let exitCode: number | null | undefined;
  child.on('exit', (code) => {
    exitCode = code;
  });
  child.on('error', (error) => {
    exitCode = null;
    stderr += `${stderr === '' ? '' : '\n'}${error.message}`;
  });

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exitCode !== undefined) return { kind: 'exited', code: exitCode, stderr };
    // Ready means the health url reports the child's own pid: an orphaned garden already
    // holding the port would otherwise pass for the server this child is about to fail to start.
    const reported = await fetchHealthPid(healthUrl);
    if (typeof reported === 'number' && reported === child.pid) {
      child.unref();
      return { kind: 'ready', pid: reported };
    }
    if (Date.now() >= deadline) {
      child.kill('SIGTERM');
      return { kind: 'timed-out', stderr, pid: child.pid };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
