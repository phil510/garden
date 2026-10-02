import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { aHookEvent } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_STATE } from '../../src/adapters/store.js';
import { createProjection } from '../../src/app/projection.js';
import type { OverlayState, StorePort } from '../../src/app/ports.js';
import { claudeSettings } from '../../src/appdir.js';
import { createServer as createGardenServer } from '../../src/http/server.js';

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

  it('exits zero when the connection is refused, so the hook never blocks the tool call', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    // curl exits 7 on a refused connection; `|| true` is what turns that into zero,
    // and a non-zero PreToolUse hook would block the tool call.
    expect(await runHook('{}', port)).toBe(0);
  });

  it('gives up on a server that accepts but never answers', async () => {
    const sockets: Socket[] = [];
    const server = createServer(() => {
      // Deliberately never responds: only --max-time ends this request.
    });
    server.on('connection', (socket) => sockets.push(socket));
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const started = Date.now();
      expect(await runHook('{}', port)).toBe(0);
      // --max-time 1 plus process startup; without the flag curl would hang forever.
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function fakeStore(): StorePort {
  let current: OverlayState = DEFAULT_OVERLAY_STATE;
  return {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
}

describe('a real Claude Code hook command against the real /hooks route', () => {
  it('reaches the endpoint and is folded into that session', async () => {
    const projection = createProjection(fakeStore());
    const app = createGardenServer({
      projection,
      tmux: {
        listPanes: () => Promise.reject(new Error('not used by this test')),
        newSession: () => Promise.reject(new Error('not used by this test')),
        respawnPane: () => Promise.reject(new Error('not used by this test')),
        killSession: () => Promise.reject(new Error('not used by this test')),
      },
      store: fakeStore(),
      configPort: {
        read: () => {
          throw new Error('not used by this test');
        },
        write: () => {
          throw new Error('not used by this test');
        },
      },
      git: {
        status: () => Promise.reject(new Error('not used by this test')),
        workTreePrefix: () => Promise.reject(new Error('not used by this test')),
      },
      attach: {
        attach: () => {
          throw new Error('not used by this test');
        },
      },
      repos: {
        list: () => Promise.resolve([]),
        resolveRoot: () => Promise.reject(new Error('not used by this test')),
      },
      serverPort: 4310,
      settingsPath: '/home/.garden/claude-settings.json',
      readClaudeCommand: () => ['claude'],
      deadSessionCap: 10,
      terminalFontSize: 13,
    });
    try {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const payload = aHookEvent({
        session_id: 'sid-real-hook',
        cwd: '/Users/dev/real-repo',
        hook_event_name: 'SessionStart',
      });

      expect(await runHook(JSON.stringify(payload), port)).toBe(0);

      const session = projection.sessions().find((s) => s.id === 'sid-real-hook');
      expect(session?.cwd).toBe('/Users/dev/real-repo');
    } finally {
      await app.close();
    }
  });
});
