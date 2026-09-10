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
    // No server on this socket means nothing to kill, which is success, not a failure.
    if (/no server running|error connecting to/i.test(stderr)) return;
    throw error;
  }
}
