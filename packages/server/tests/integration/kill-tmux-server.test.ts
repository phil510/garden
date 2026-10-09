import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { killTmuxServer, tmuxSocketPath } from '../../src/cli/tmux.js';

const execFileAsync = promisify(execFile);

// Short path: macOS caps unix socket paths near 104 bytes, and os.tmpdir() eats most of it.
let tmuxTmpdir: string;
let socket: string;
let confPath: string;

beforeEach(() => {
  tmuxTmpdir = mkdtempSync('/tmp/g-');
  vi.stubEnv('TMUX_TMPDIR', tmuxTmpdir);
  socket = `garden-test-${randomBytes(4).toString('hex')}`;
  confPath = join(tmuxTmpdir, 'tmux.conf');
  writeFileSync(confPath, '');
});

afterEach(async () => {
  await execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => {});
  vi.unstubAllEnvs();
  rmSync(tmuxTmpdir, { recursive: true, force: true });
});

describe('killTmuxServer', () => {
  it('resolves when no server was ever started', async () => {
    await expect(killTmuxServer(confPath, socket)).resolves.toBeUndefined();
  });

  it.skipIf(process.getuid?.() === 0)(
    'rejects naming the socket path when the socket directory denies access',
    async () => {
      const socketDir = join(tmuxTmpdir, `tmux-${String(process.getuid?.())}`);
      mkdirSync(socketDir);
      chmodSync(socketDir, 0o000);
      try {
        await expect(killTmuxServer(confPath, socket)).rejects.toThrow(tmuxSocketPath(socket));
      } finally {
        chmodSync(socketDir, 0o700);
      }
    },
  );

  it('kills a live server', async () => {
    await execFileAsync('tmux', ['-L', socket, '-f', confPath, 'new-session', '-d']);

    await killTmuxServer(confPath, socket);

    await expect(execFileAsync('tmux', ['-L', socket, 'has-session'])).rejects.toThrow();
  });
});
