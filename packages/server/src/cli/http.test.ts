import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CliHttpError,
  createSession,
  handoffSession,
  killSession,
  listSessions,
  placeSession,
  resumeSession,
} from './http.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let home: string;
let originalHome: string | undefined;
let originalPort: string | undefined;

function startServer(handler: Handler): Promise<void> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      process.env.GARDEN_PORT = String(port);
      resolve();
    });
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'garden-cli-home-'));
  originalHome = process.env.HOME;
  originalPort = process.env.GARDEN_PORT;
  process.env.HOME = home;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server?.listening) server.close(() => resolve());
    else resolve();
  });
  rmSync(home, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPort === undefined) delete process.env.GARDEN_PORT;
  else process.env.GARDEN_PORT = originalPort;
});

describe('listSessions', () => {
  it('parses the sessions response from the server', async () => {
    await startServer((request, response) => {
      expect(request.method).toBe('GET');
      expect(request.url).toBe('/sessions');
      sendJson(response, 200, { sessions: [] });
    });
    await expect(listSessions()).resolves.toEqual({ sessions: [] });
  });

  it('sends no query string when called with no filter', async () => {
    await startServer((request, response) => {
      expect(request.url).toBe('/sessions');
      sendJson(response, 200, { sessions: [] });
    });
    await expect(listSessions()).resolves.toEqual({ sessions: [] });
  });

  it('builds a query string from the filter fields that are set', async () => {
    await startServer((request, response) => {
      expect(request.url).toBe('/sessions?sinceDays=30&maxRecapChars=100&live=true&status=working');
      sendJson(response, 200, { sessions: [] });
    });
    await expect(
      listSessions({ sinceDays: 30, maxRecapChars: 100, live: true, status: 'working' }),
    ).resolves.toEqual({ sessions: [] });
  });

  it('omits unset filter fields from the query string', async () => {
    await startServer((request, response) => {
      expect(request.url).toBe('/sessions?sinceDays=30');
      sendJson(response, 200, { sessions: [] });
    });
    await expect(listSessions({ sinceDays: 30 })).resolves.toEqual({ sessions: [] });
  });

  it('sends swarmId as a swarm query param', async () => {
    await startServer((request, response) => {
      expect(request.url).toBe('/sessions?swarm=swarm-1');
      sendJson(response, 200, { sessions: [] });
    });
    await expect(listSessions({ swarmId: 'swarm-1' })).resolves.toEqual({ sessions: [] });
  });
});

describe('createSession', () => {
  it('posts the cwd and returns the minted id and tmux name', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(request.method).toBe('POST');
        expect(request.url).toBe('/sessions');
        expect(JSON.parse(await readBody(request))).toEqual({ cwd: '/repo' });
        sendJson(response, 200, { id: 'abc', tmuxName: 'repo' });
      })();
    });
    await expect(createSession('/repo')).resolves.toEqual({ id: 'abc', tmuxName: 'repo' });
  });

  it('includes callerSessionId in the body when provided', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(JSON.parse(await readBody(request))).toEqual({
          cwd: '/repo',
          callerSessionId: 'caller-1',
        });
        sendJson(response, 200, { id: 'abc', tmuxName: 'repo' });
      })();
    });
    await expect(createSession('/repo', 'caller-1')).resolves.toEqual({
      id: 'abc',
      tmuxName: 'repo',
    });
  });

  it('includes handoff: true in the body when requested', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(JSON.parse(await readBody(request))).toEqual({
          cwd: '/repo',
          callerSessionId: 'caller-1',
          handoff: true,
        });
        sendJson(response, 200, { id: 'abc', tmuxName: 'repo' });
      })();
    });
    await expect(createSession('/repo', 'caller-1', true)).resolves.toEqual({
      id: 'abc',
      tmuxName: 'repo',
    });
  });

  it('omits handoff from the body when not requested', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(JSON.parse(await readBody(request))).toEqual({ cwd: '/repo' });
        sendJson(response, 200, { id: 'abc', tmuxName: 'repo' });
      })();
    });
    await expect(createSession('/repo', undefined, false)).resolves.toEqual({
      id: 'abc',
      tmuxName: 'repo',
    });
  });

  it('includes handoffFilePath in the body when provided', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(JSON.parse(await readBody(request))).toEqual({
          cwd: '/repo',
          callerSessionId: 'caller-1',
          handoff: true,
          handoffFilePath: '/repo/.handoffs/2026-01-01-topic.md',
        });
        sendJson(response, 200, { id: 'abc', tmuxName: 'repo' });
      })();
    });
    await expect(
      createSession('/repo', 'caller-1', true, '/repo/.handoffs/2026-01-01-topic.md'),
    ).resolves.toEqual({ id: 'abc', tmuxName: 'repo' });
  });

  it('omits handoffFilePath from the body when not provided', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(JSON.parse(await readBody(request))).toEqual({
          cwd: '/repo',
          callerSessionId: 'caller-1',
          handoff: true,
        });
        sendJson(response, 200, { id: 'abc', tmuxName: 'repo' });
      })();
    });
    await expect(createSession('/repo', 'caller-1', true)).resolves.toEqual({
      id: 'abc',
      tmuxName: 'repo',
    });
  });
});

describe('handoffSession', () => {
  it('posts { to } to the handoff route', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(request.method).toBe('POST');
        expect(request.url).toBe('/sessions/a/handoff');
        expect(JSON.parse(await readBody(request))).toEqual({ to: 'b' });
        sendJson(response, 200, { ok: true });
      })();
    });
    await expect(handoffSession('a', 'b')).resolves.toEqual({ ok: true });
  });
});

describe('placeSession', () => {
  it('posts { placement } to the placement route', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(request.method).toBe('POST');
        expect(request.url).toBe('/sessions/a/placement');
        expect(JSON.parse(await readBody(request))).toEqual({
          placement: { type: 'parent', parentId: 'b' },
        });
        sendJson(response, 200, { ok: true });
      })();
    });
    await expect(placeSession('a', { type: 'parent', parentId: 'b' })).resolves.toEqual({
      ok: true,
    });
  });
});

describe('resumeSession', () => {
  it('posts to the resume route with the id URL-encoded', async () => {
    await startServer((request, response) => {
      expect(request.url).toBe('/sessions/a%2Fb/resume');
      sendJson(response, 200, { id: 'a/b', tmuxName: 'repo' });
    });
    await expect(resumeSession('a/b')).resolves.toEqual({ id: 'a/b', tmuxName: 'repo' });
  });
});

describe('killSession', () => {
  it('posts to the kill route and returns ok', async () => {
    await startServer((request, response) => {
      expect(request.url).toBe('/sessions/abc/kill');
      sendJson(response, 200, { ok: true });
    });
    await expect(killSession('abc')).resolves.toEqual({ ok: true });
  });
});

describe('errors', () => {
  it('surfaces the server error message on a non-ok response', async () => {
    await startServer((_request, response) => {
      sendJson(response, 404, { error: 'no such session: abc' });
    });
    await expect(listSessions()).rejects.toThrow(new CliHttpError('no such session: abc'));
  });

  it('reports the server as not running when the connection is refused', async () => {
    process.env.GARDEN_PORT = '1';
    await expect(listSessions()).rejects.toThrow(/not running/);
  });
});
