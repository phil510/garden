import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface TmuxServerContext {
  readonly socket: string;
  readonly confPath: string;
}

/**
 * Runs `fn` against a fresh tmux server on a socket nobody else uses and kills it
 * whether `fn` threw or not. The socket name is literal on purpose: it is what
 * makes pointing a test at the real garden socket impossible.
 */
export async function withTmuxServer(fn: (ctx: TmuxServerContext) => Promise<void>): Promise<void> {
  const socket = `garden-test-${randomBytes(4).toString('hex')}`;
  const dir = mkdtempSync(join(tmpdir(), 'garden-tmux-'));
  const confPath = join(dir, 'tmux.conf');
  try {
    // Passed as -f on the first command that touches the socket: that command starts
    // the server, and remain-on-exit has to be set by then.
    writeFileSync(confPath, 'set-option -g remain-on-exit on\n', 'utf8');
    await fn({ socket, confPath });
  } finally {
    await execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}
