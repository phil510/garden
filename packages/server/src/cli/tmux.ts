import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The documented exception in docs/architecture.md §4.4: `uninstall` and `stop --all` must
 *  work with the garden server dead, so they shell out to tmux directly instead of going
 *  through it. */
export async function killTmuxServer(confPath: string, socket: string): Promise<void> {
  try {
    await execFileAsync('tmux', ['-L', socket, '-f', confPath, 'kill-server']);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    // No server on this socket means nothing to kill, which is success, not a failure. tmux
    // reports that as "no server running" or as a connect failure whose reason is specifically
    // "No such file or directory" — every other connect-failure reason (bad permissions, a
    // socket path that isn't a socket, etc.) is a real failure and must not be swallowed.
    if (/no server running|error connecting to .*\(no such file or directory\)/i.test(stderr)) {
      return;
    }
    throw error;
  }
}
