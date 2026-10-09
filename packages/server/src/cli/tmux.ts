import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Where tmux puts the socket for `-L <socket>`: `<TMUX_TMPDIR or /tmp>/tmux-<uid>/<socket>`. */
export function tmuxSocketPath(socket: string, env: NodeJS.ProcessEnv = process.env): string {
  const tmpdir = env.TMUX_TMPDIR?.startsWith('/') ? env.TMUX_TMPDIR : '/tmp';
  return join(tmpdir, `tmux-${String(process.getuid?.() ?? 0)}`, socket);
}

export type SocketProbe = 'absent' | 'live' | { readonly unreachable: string };

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? 'unknown error';
}

function connects(path: string): Promise<SocketProbe> {
  return new Promise((resolve) => {
    const conn = createConnection(path);
    conn.once('connect', () => {
      conn.destroy();
      resolve('live');
    });
    conn.once('error', (error) => {
      conn.destroy();
      // A crashed server leaves its socket file behind; refusing the connection means no
      // server, not an unreachable one.
      const code = errorCode(error);
      resolve(code === 'ECONNREFUSED' || code === 'ENOENT' ? 'absent' : { unreachable: code });
    });
  });
}

/** Classifies the socket by errno codes, which are portable, rather than tmux's stderr text. */
export async function probeSocket(path: string): Promise<SocketProbe> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' ? 'absent' : { unreachable: code };
  }
  if (!stats.isSocket()) return { unreachable: 'not a socket' };
  return connects(path);
}

/** The documented exception in docs/architecture.md §4.4: `uninstall` and `stop --all` must
 *  work with the garden server dead, so they shell out to tmux directly instead of going
 *  through it. A garden socket with no server behind it is a silent no-op; one that exists
 *  but can't be reached throws, so callers don't report a kill that never happened. */
export async function killTmuxServer(confPath: string, socket: string): Promise<void> {
  try {
    await execFileAsync('tmux', ['-L', socket, '-f', confPath, 'kill-server']);
  } catch (error) {
    // tmux never ran (e.g. not on PATH): that says nothing about whether a server exists.
    if (typeof (error as { code?: unknown }).code !== 'number') throw error;

    const path = tmuxSocketPath(socket);
    const probe = await probeSocket(path);
    if (probe === 'absent') return;
    if (probe === 'live') throw error;
    throw new Error(`cannot reach the tmux server socket ${path} (${probe.unreachable})`, {
      cause: error,
    });
  }
}
