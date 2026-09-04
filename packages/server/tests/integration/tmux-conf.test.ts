import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { writeTmuxConf } from '../../src/appdir.js';

const execFileAsync = promisify(execFile);

describe('the generated tmux.conf', () => {
  it('is accepted by tmux and sets the options garden depends on', async () => {
    // Socket name written literally here so no config bug can point this at the
    // tmux server holding the developer's real sessions.
    const socket = `garden-test-${randomBytes(4).toString('hex')}`;
    const home = mkdtempSync(join(tmpdir(), 'garden-home-'));
    const tmux = (...args: string[]) => execFileAsync('tmux', ['-L', socket, ...args]);
    try {
      // A detached session keeps the server alive past this call; tmux's default
      // exit-empty would otherwise kill a server started with no session attached.
      // A line the conf cannot parse makes this exit non-zero, naming the line.
      await execFileAsync('tmux', ['-L', socket, '-f', writeTmuxConf(home), 'new-session', '-d']);
      expect((await tmux('show-options', '-g', 'mouse')).stdout.trim()).toBe('mouse on');
      expect((await tmux('show-options', '-g', 'status')).stdout.trim()).toBe('status off');
      expect((await tmux('show-options', '-g', '-w', 'remain-on-exit')).stdout.trim()).toBe(
        'remain-on-exit on',
      );
    } finally {
      await tmux('kill-server').catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('rewrites the file rather than appending to it on a second boot', () => {
    const home = mkdtempSync(join(tmpdir(), 'garden-home-'));
    try {
      const first = readFileSync(writeTmuxConf(home), 'utf8');
      expect(readFileSync(writeTmuxConf(home), 'utf8')).toBe(first);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
