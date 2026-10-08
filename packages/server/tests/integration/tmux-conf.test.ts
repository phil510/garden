import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { attachPty } from '../../src/adapters/pty.js';
import { writeTmuxConf } from '../../src/appdir.js';
import { until } from './support/poll.js';

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
      await execFileAsync('tmux', [
        '-L',
        socket,
        '-f',
        writeTmuxConf(join(home, '.garden')),
        'new-session',
        '-d',
      ]);
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
      const first = readFileSync(writeTmuxConf(join(home, '.garden')), 'utf8');
      expect(readFileSync(writeTmuxConf(join(home, '.garden')), 'utf8')).toBe(first);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('forwards an OSC 8 hyperlink to a client attached the way garden attaches', async () => {
    const socket = `garden-test-${randomBytes(4).toString('hex')}`;
    const home = mkdtempSync(join(tmpdir(), 'garden-home-'));
    const confPath = writeTmuxConf(join(home, '.garden'));
    let attachment: ReturnType<typeof attachPty> | undefined;
    try {
      // The pane prints the link only once it reads a line, so the attached client is
      // certain to be there to receive it.
      const printLink =
        "read line; printf '\\033]8;id=x;https://example.com/linked\\007LABEL\\033]8;;\\007\\n'; sleep 60";
      await execFileAsync('tmux', [
        '-L',
        socket,
        '-f',
        confPath,
        'new-session',
        '-d',
        '-s',
        'osc8',
        'sh',
        '-c',
        printLink,
      ]);
      let received = '';
      attachment = attachPty(
        { socket, confPath },
        'osc8',
        { cols: 80, rows: 24 },
        { onData: (chunk) => (received += chunk), onExit: () => {} },
      );
      attachment.write('\n');
      await until(
        'the client to receive the OSC 8 hyperlink',
        () => Promise.resolve(received),
        (text) => text.includes('\u001b]8;') && text.includes('https://example.com/linked'),
      );
    } finally {
      attachment?.kill();
      await execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  });
});
