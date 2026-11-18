import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimReview,
  CliHttpError,
  createSession,
  dismissReview,
  killSession,
  listSessions,
  placeSession,
  resumeSession,
  sendSessionMessage,
  unwatch,
  watch,
  watches,
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
  vi.unstubAllGlobals();
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

  it('includes model and effort in the body when provided', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(JSON.parse(await readBody(request))).toEqual({
          cwd: '/repo',
          model: 'opus',
          effort: 'high',
        });
        sendJson(response, 200, { id: 'abc', tmuxName: 'repo' });
      })();
    });
    await expect(
      createSession('/repo', undefined, { model: 'opus', effort: 'high' }),
    ).resolves.toEqual({ id: 'abc', tmuxName: 'repo' });
  });
});

describe('session name transport', () => {
  it('preserves the literal target when passing supported commands to the server', async () => {
    const paths: (string | undefined)[] = [];
    await startServer((request, response) => {
      paths.push(request.url);
      sendJson(response, 200, { ok: true });
    });
    const longName =
      'Migration readiness across permissions, customer-specific configuration, and observability before launch 🚀 / + &';
    await killSession(longName);
    await killSession('.');
    await resumeSession('..');
    await sendSessionMessage('.', 'hello');
    await placeSession('..', { type: 'parent', parentId: 'caller' });
    expect(paths).toEqual([
      `/sessions/-/kill?${new URLSearchParams({ target: longName }).toString()}`,
      '/sessions/-/kill?target=.',
      '/sessions/-/resume?target=..',
      '/sessions/-/messages?target=.',
      '/sessions/-/placement?target=..',
    ]);
  });
});

describe('placeSession', () => {
  it('posts { placement } to the placement route', async () => {
    const id = '8fb1bdb0-acd1-4195-9d52-88dea91f21db';
    await startServer((request, response) => {
      void (async () => {
        expect(request.method).toBe('POST');
        expect(request.url).toBe(`/sessions/${id}/placement`);
        expect(JSON.parse(await readBody(request))).toEqual({
          placement: { type: 'parent', parentId: 'b' },
        });
        sendJson(response, 200, { ok: true });
      })();
    });
    await expect(placeSession(id, { type: 'parent', parentId: 'b' })).resolves.toEqual({
      ok: true,
    });
  });
});

describe('resumeSession', () => {
  it('posts to the resume route with the name URL-encoded', async () => {
    await startServer((request, response) => {
      expect(request.url).toBe('/sessions/-/resume?target=a%2Fb');
      sendJson(response, 200, { id: 'a/b', tmuxName: 'repo' });
    });
    await expect(resumeSession('a/b')).resolves.toEqual({ id: 'a/b', tmuxName: 'repo' });
  });

  it('sends model and effort as a JSON body', async () => {
    await startServer((request, response) => {
      void (async () => {
        expect(JSON.parse(await readBody(request))).toEqual({ model: 'opus', effort: 'max' });
        sendJson(response, 200, { id: 'a', tmuxName: 'repo' });
      })();
    });
    await expect(resumeSession('a', { model: 'opus', effort: 'max' })).resolves.toEqual({
      id: 'a',
      tmuxName: 'repo',
    });
  });
});

describe('killSession', () => {
  it('posts to the kill route and returns ok', async () => {
    const id = '8fb1bdb0-acd1-4195-9d52-88dea91f21db';
    await startServer((request, response) => {
      expect(request.url).toBe(`/sessions/${id}/kill`);
      sendJson(response, 200, { ok: true });
    });
    await expect(killSession(id)).resolves.toEqual({ ok: true });
  });
});

describe('watch verbs', () => {
  it('posts the watch request to the session watches route', async () => {
    const summary = {
      repo: 'o/n',
      pr: 5,
      kinds: ['review'],
      pendingDigest: false,
      status: 'active',
    };
    let body = '';
    await startServer((request, response) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/sessions/a%20b/watches');
      void readBody(request).then((text) => {
        body = text;
        sendJson(response, 200, { watch: summary });
      });
    });
    await expect(watch('a b', { pr: 5, kinds: ['review'] })).resolves.toEqual({ watch: summary });
    expect(JSON.parse(body)).toEqual({ pr: 5, kinds: ['review'] });
  });

  it('deletes by pr and repo query and lists with a GET', async () => {
    const seen: string[] = [];
    await startServer((request, response) => {
      seen.push(`${request.method ?? ''} ${request.url ?? ''}`);
      sendJson(response, 200, request.method === 'GET' ? { watches: [] } : { ok: true });
    });
    await unwatch('s1', { pr: 5, repo: 'o/n' });
    await unwatch('s1', { pr: 6 });
    await watches('s1');
    expect(seen).toEqual([
      'DELETE /sessions/s1/watches?pr=5&repo=o%2Fn',
      'DELETE /sessions/s1/watches?pr=6',
      'GET /sessions/s1/watches',
    ]);
  });
});

describe('errors', () => {
  it('surfaces the server error message on a non-ok response', async () => {
    await startServer((_request, response) => {
      sendJson(response, 404, { error: 'no such session: abc' });
    });
    await expect(listSessions()).rejects.toThrow(
      new CliHttpError('no such session: abc', { status: 404 }),
    );
  });

  it('reports the server as not running only after a refused connection', async () => {
    await startServer((_request, response) => sendJson(response, 200, { sessions: [] }));
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    await expect(listSessions()).rejects.toMatchObject({
      message: `garden server is not running at http://127.0.0.1:${process.env.GARDEN_PORT ?? ''}/sessions`,
      cause: { cause: { code: 'ECONNREFUSED' } },
    });
  });

  it.each(['EPERM', 'EACCES'])(
    'reports %s as denied network access with the endpoint',
    async (code) => {
      process.env.GARDEN_PORT = '47123';
      const cause = new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect denied'), { code }),
      });
      vi.stubGlobal('fetch', () => Promise.reject(cause));

      await expect(listSessions()).rejects.toMatchObject({
        message: `cannot reach garden server at http://127.0.0.1:47123/sessions: ${code}: connect denied — check this command's network permissions`,
        cause,
      });
    },
  );

  it('keeps an unknown transport failure visible without start-server advice', async () => {
    process.env.GARDEN_PORT = '47123';
    const cause = new TypeError('fetch failed', {
      cause: new Error('unexpected transport failure'),
    });
    vi.stubGlobal('fetch', () => Promise.reject(cause));

    await expect(listSessions()).rejects.toMatchObject({
      message:
        'cannot reach garden server at http://127.0.0.1:47123/sessions: unexpected transport failure',
      cause,
    });
  });

  it('reports cancellation rather than claiming the server is stopped', async () => {
    const id = '8fb1bdb0-acd1-4195-9d52-88dea91f21db';
    await startServer((_request, response) => sendJson(response, 200, { ok: true }));
    const controller = new AbortController();
    const cause = new Error('message cancelled');
    controller.abort(cause);

    await expect(sendSessionMessage(id, 'hello', controller.signal)).rejects.toMatchObject({
      message: `cannot reach garden server at http://127.0.0.1:${process.env.GARDEN_PORT ?? ''}/sessions/${id}/messages: message cancelled`,
      cause,
    });
  });

  it('preserves configuration validation errors before attempting a connection', async () => {
    process.env.GARDEN_PORT = 'invalid';
    await expect(listSessions()).rejects.toThrow('GARDEN_PORT must be an integer');
  });
});

describe('review requests', () => {
  it('resolves a dismiss that answers 204 with no body', async () => {
    await startServer((_request, response) => {
      response.writeHead(204).end();
    });
    await expect(dismissReview('acme', 'widgets', 7)).resolves.toBeUndefined();
  });

  it('reports the kind and GitHub status of a refused dismiss', async () => {
    await startServer((_request, response) => {
      sendJson(response, 502, { kind: 'error', status: 422 });
    });
    await expect(dismissReview('acme', 'widgets', 7)).rejects.toThrow(
      new CliHttpError('GitHub refused the dismiss: error (422)', { status: 502 }),
    );
  });

  it('reports a refused dismiss that carries no GitHub status', async () => {
    await startServer((_request, response) => {
      sendJson(response, 502, { kind: 'logged-out' });
    });
    await expect(dismissReview('acme', 'widgets', 7)).rejects.toThrow(
      'GitHub refused the dismiss: logged-out',
    );
  });

  it('surfaces the server error of a claim for a PR that is not queued', async () => {
    await startServer((_request, response) => {
      sendJson(response, 404, { error: 'no review request acme/widgets#7' });
    });
    await expect(claimReview('acme', 'widgets', 7, 's1')).rejects.toThrow(
      'no review request acme/widgets#7',
    );
  });
});

describe('sendSessionMessage', () => {
  it('sends quoted multiline text as JSON to the encoded session name', async () => {
    const message = 'A "quoted" note\nnext line';
    await startServer((request, response) => {
      void readBody(request).then((body) => {
        expect(request.method).toBe('POST');
        expect(request.url).toBe('/sessions/-/messages?target=s%2F1');
        expect(request.headers['content-type']).toBe('application/json');
        expect(JSON.parse(body)).toEqual({ message });
        sendJson(response, 200, { ok: true });
      });
    });
    await expect(sendSessionMessage('s/1', message)).resolves.toEqual({ ok: true });
  });

  it('rejects a refused enqueue so the caller can retain the digest', async () => {
    await startServer((_request, response) =>
      sendJson(response, 409, { error: 'session is dead' }),
    );
    await expect(sendSessionMessage('s1', 'hello')).rejects.toThrow('session is dead');
  });
});
