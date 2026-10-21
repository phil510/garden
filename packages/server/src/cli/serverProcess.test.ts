import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isProcessRunning } from './pid.js';
import { fetchHealthPid, spawnServer } from './serverProcess.js';

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
      `import { createServer } from 'node:http';\ncreateServer((_req, res) => { res.end(JSON.stringify({ status: 'ok', pid: process.pid })); }).listen(${String(port)}, '127.0.0.1');\n`,
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

  it('is not ready while the health url reports a different pid, and times out', async () => {
    const port = await reservePort();
    const script = writeScript(
      'otherPid.mjs',
      `import { createServer } from 'node:http';\ncreateServer((_req, res) => { res.end(JSON.stringify({ status: 'ok', pid: process.pid + 1 })); }).listen(${String(port)}, '127.0.0.1');\n`,
    );

    const result = await spawnServer(
      script,
      [],
      process.env,
      `http://127.0.0.1:${String(port)}/health`,
      400,
    );

    expect(result.kind).toBe('timed-out');
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

describe('fetchHealthPid', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
  });

  function serve(handler: RequestListener): Promise<string> {
    return new Promise((resolve) => {
      server = createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        resolve(`http://127.0.0.1:${String(port)}/health`);
      });
    });
  }

  it('returns the pid the health body reports', async () => {
    const url = await serve((_req, res) => {
      res.end(JSON.stringify({ status: 'ok', pid: 4242 }));
    });

    expect(await fetchHealthPid(url)).toBe(4242);
  });

  it('reports no-answer when the body carries no numeric pid', async () => {
    const url = await serve((_req, res) => {
      res.end('ok');
    });

    expect(await fetchHealthPid(url)).toBe('no-answer');
  });

  it('reports no-answer for a non-2xx response', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ pid: 4242 }));
    });

    expect(await fetchHealthPid(url)).toBe('no-answer');
  });

  it('reports refused when nothing is listening on the port', async () => {
    const port = await reservePort();

    expect(await fetchHealthPid(`http://127.0.0.1:${String(port)}/health`)).toBe('refused');
  });

  it('reports no-answer when the server never responds within the timeout', async () => {
    const url = await serve(() => {
      // never responds
    });

    expect(await fetchHealthPid(url, 150)).toBe('no-answer');
  });
});
