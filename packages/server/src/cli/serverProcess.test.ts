import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isProcessRunning } from './pid.js';
import { spawnServer } from './serverProcess.js';

let dir: string;

/** A free loopback port, released immediately — the child binds it right after. */
function reservePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

function writeScript(name: string, source: string): string {
  const path = join(dir, name);
  writeFileSync(path, source, 'utf8');
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'garden-cli-serverprocess-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('spawnServer', () => {
  it('reports ready once the health url answers, leaving the process running', async () => {
    const port = await reservePort();
    const script = writeScript(
      'ready.mjs',
      `import { createServer } from 'node:http';\ncreateServer((_req, res) => { res.end('ok'); }).listen(${String(port)}, '127.0.0.1');\n`,
    );

    const result = await spawnServer(
      script,
      [],
      process.env,
      `http://127.0.0.1:${String(port)}/health`,
      3000,
    );

    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') {
      expect(isProcessRunning(result.pid)).toBe(true);
      process.kill(result.pid, 'SIGTERM');
    }
  });

  it('reports exited with the child stderr when it exits before becoming healthy', async () => {
    const port = await reservePort();
    const script = writeScript('exits.mjs', "process.stderr.write('boom\\n');\nprocess.exit(7);\n");

    const result = await spawnServer(
      script,
      [],
      process.env,
      `http://127.0.0.1:${String(port)}/health`,
      3000,
    );

    expect(result).toEqual({ kind: 'exited', code: 7, stderr: 'boom\n' });
  });

  it('appends args to the spawned process argv, after scriptPath', async () => {
    const port = await reservePort();
    const script = writeScript(
      'echoArgv.mjs',
      "process.stderr.write(process.argv.slice(2).join(','));\nprocess.exit(7);\n",
    );

    const result = await spawnServer(
      script,
      ['--detached'],
      process.env,
      `http://127.0.0.1:${String(port)}/health`,
      3000,
    );

    expect(result).toEqual({ kind: 'exited', code: 7, stderr: '--detached' });
  });

  it('kills and reports timed-out when the health url never answers', async () => {
    const port = await reservePort();
    const script = writeScript('hangs.mjs', 'setInterval(() => {}, 1000);\n');

    const before = Date.now();
    const result = await spawnServer(
      script,
      [],
      process.env,
      `http://127.0.0.1:${String(port)}/health`,
      300,
    );

    expect(result.kind).toBe('timed-out');
    expect(Date.now() - before).toBeLessThan(3000);

    const pid = result.kind === 'timed-out' ? result.pid : undefined;
    expect(pid).toBeDefined();
    const deadline = Date.now() + 2000;
    while (pid !== undefined && isProcessRunning(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(pid !== undefined && isProcessRunning(pid)).toBe(false);
  });
});
