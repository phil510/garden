import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// A dedicated -L socket per run, named literally here so no config bug can
// point this at the tmux server the user has their real sessions in.
const SOCKET = `garden-scaffold-test-${process.pid}`;
const SESSION = 'scaffold';

function tmux(...args: string[]) {
  return execFileAsync('tmux', ['-L', SOCKET, ...args]);
}

describe('tmux on an isolated socket', () => {
  afterAll(async () => {
    await tmux('kill-server').catch(() => {});
  });

  it('creates, lists, and kills a session', async () => {
    await tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24');

    const { stdout } = await tmux('list-sessions', '-F', '#{session_name}');
    expect(stdout.trim().split('\n')).toContain(SESSION);

    await tmux('kill-session', '-t', SESSION);
    await expect(tmux('list-sessions')).rejects.toThrow();
  });
});
