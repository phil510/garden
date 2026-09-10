import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { killTmuxServer } from '../../src/cli/tmux.js';

describe('killTmuxServer', () => {
  it('resolves when there is no server on the socket', async () => {
    const home = mkdtempSync(join(tmpdir(), 'garden-tmux-kill-'));
    try {
      await expect(
        killTmuxServer('/dev/null', `garden-test-nonexistent-${process.pid}`),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects on a real connection failure instead of swallowing it as "nothing to kill"', async () => {
    // tmux -L resolves the socket under $TMUX_TMPDIR/tmux-<uid>/<name>. Placing an
    // unreadable, non-socket file there reproduces the "Socket operation on non-socket"
    // connect failure this fix distinguishes from the genuine no-server case.
    const tmuxTmpDir = mkdtempSync(join(tmpdir(), 'garden-tmux-badsock-'));
    const socketDir = join(tmuxTmpDir, `tmux-${String(process.getuid?.() ?? 0)}`);
    mkdirSync(socketDir, { mode: 0o700 });
    const socketName = 'badsock';
    const socketPath = join(socketDir, socketName);
    mkdirSync(socketPath); // a directory, not a socket, in the socket's place
    const previousTmuxTmpDir = process.env.TMUX_TMPDIR;
    process.env.TMUX_TMPDIR = tmuxTmpDir;
    try {
      await expect(killTmuxServer('/dev/null', socketName)).rejects.toThrow();
    } finally {
      if (previousTmuxTmpDir === undefined) delete process.env.TMUX_TMPDIR;
      else process.env.TMUX_TMPDIR = previousTmuxTmpDir;
      chmodSync(socketDir, 0o700);
      rmSync(tmuxTmpDir, { recursive: true, force: true });
    }
  });
});
