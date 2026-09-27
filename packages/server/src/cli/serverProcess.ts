import { spawn } from 'node:child_process';

export type SpawnResult =
  | { readonly kind: 'ready'; readonly pid: number }
  | { readonly kind: 'exited'; readonly code: number | null; readonly stderr: string }
  | { readonly kind: 'timed-out'; readonly stderr: string; readonly pid: number | undefined };

const POLL_INTERVAL_MS = 50;

/** Default readiness timeout for `spawnServer`. `describeStartupFailure` (in `start.ts`) names
 *  this same value in its timed-out message, so the two never drift apart. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;

async function probeHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Spawns `scriptPath` as a detached background process — this is how `garden` daemonises
 * itself, re-invoking its own entry point with `env` carrying the marker that routes it to
 * `main()` instead of back through the CLI dispatch, plus `args` (e.g. `SERVER_DETACHED_FLAG`)
 * appended to its argv — and polls `healthUrl` until it answers or `timeoutMs` passes. The
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
    if (await probeHealth(healthUrl)) {
      child.unref();
      const pid = child.pid;
      if (pid === undefined) {
        return {
          kind: 'timed-out',
          stderr: 'server became healthy but reported no pid',
          pid: undefined,
        };
      }
      return { kind: 'ready', pid };
    }
    if (Date.now() >= deadline) {
      child.kill('SIGTERM');
      return { kind: 'timed-out', stderr, pid: child.pid };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
