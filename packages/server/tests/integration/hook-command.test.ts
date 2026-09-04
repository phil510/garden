import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { claudeSettings } from '../../src/appdir.js';

function hookCommand(): string {
  const command = claudeSettings().hooks.SessionStart?.[0]?.hooks[0]?.command;
  if (command === undefined) throw new Error('no SessionStart hook command');
  return command;
}

function runHook(payload: string, port: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', hookCommand()], {
      env: { ...process.env, GARDEN_PORT: String(port) },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', reject);
    child.on('close', resolve);
    child.stdin.end(payload);
  });
}

describe('the generated hook command', () => {
  it('POSTs its stdin payload verbatim to /hooks on the port in GARDEN_PORT', async () => {
    const seen: { path: string | undefined; body: string } = { path: undefined, body: '' };
    const server = createServer((req, res) => {
      seen.path = req.url;
      req.on('data', (chunk: Buffer) => (seen.body += chunk.toString('utf8')));
      req.on('end', () => res.writeHead(204).end());
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const payload = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'abc' });
      expect(await runHook(payload, port)).toBe(0);
      expect(seen.path).toBe('/hooks');
      expect(JSON.parse(seen.body)).toEqual({
        hook_event_name: 'SessionStart',
        session_id: 'abc',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('exits zero and promptly when no server is listening', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const started = Date.now();
    // Zero because of `|| true`: a non-zero PreToolUse hook would block the tool call.
    expect(await runHook('{}', port)).toBe(0);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
