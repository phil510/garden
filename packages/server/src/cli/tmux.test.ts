import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { probeSocket, tmuxSocketPath } from './tmux.js';

// Unix socket paths are capped near 104 bytes on macOS, so the dir is under /tmp, not os.tmpdir().
let dir: string;
const servers: Server[] = [];

beforeEach(() => {
  dir = mkdtempSync('/tmp/g-probe-');
});

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  rmSync(dir, { recursive: true, force: true });
});

function listen(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    servers.push(server);
    server.once('error', reject);
    server.listen(path, resolve);
  });
}

describe('probeSocket', () => {
  it('is absent when nothing exists at the path', async () => {
    expect(await probeSocket(join(dir, 's'))).toBe('absent');
  });

  it('is absent when the parent directory is missing', async () => {
    expect(await probeSocket(join(dir, 'missing', 's'))).toBe('absent');
  });

  it('is unreachable when a regular file sits at the path', async () => {
    const path = join(dir, 's');
    writeFileSync(path, '');
    expect(await probeSocket(path)).toEqual({ unreachable: 'not a socket' });
  });

  it.skipIf(process.getuid?.() === 0)(
    'is unreachable when the parent directory denies access',
    async () => {
      const sub = join(dir, 'sub');
      mkdirSync(sub);
      chmodSync(sub, 0o000);
      try {
        expect(await probeSocket(join(sub, 's'))).toEqual({ unreachable: 'EACCES' });
      } finally {
        chmodSync(sub, 0o700);
      }
    },
  );

  it('is live when a server is listening', async () => {
    const path = join(dir, 's');
    await listen(path);
    expect(await probeSocket(path)).toBe('live');
  });

  it('is absent for a stale socket file left by a killed server', async () => {
    const path = join(dir, 's');
    const child = spawn(
      process.execPath,
      [
        '-e',
        `require('node:net').createServer().listen(${JSON.stringify(path)}, () => console.log('up'))`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;

    expect(await probeSocket(path)).toBe('absent');
  });
});

describe('tmuxSocketPath', () => {
  it('falls back to /tmp when TMUX_TMPDIR is relative', () => {
    const path = tmuxSocketPath('garden', { TMUX_TMPDIR: 'relative' });
    expect(path).toBe(`/tmp/tmux-${String(process.getuid?.() ?? 0)}/garden`);
  });
});
