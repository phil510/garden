import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVENTS_CLOSE_CODES, type Delta, type ServerMessage } from '@garden/shared';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchFsRoot } from '../../src/adapters/fsWatch.js';
import { branch, repoRoot, status, workTreePrefix } from '../../src/adapters/git.js';
import { DEFAULT_OVERLAY_STATE } from '../../src/adapters/store.js';
import { createProjection } from '../../src/app/projection.js';
import { createRepoCatalog } from '../../src/app/repoCatalog.js';
import { createRootWatches } from '../../src/app/rootWatch.js';
import type { OverlayState, StorePort } from '../../src/app/ports.js';
import { createServer } from '../../src/http/server.js';
import { settle, sleep, QUIET_WINDOW_MS } from './support/fsSignals.js';
import { noRootWatches } from './support/noRootWatches.js';
import { until } from './support/poll.js';

function fakeStore(): StorePort {
  let current: OverlayState = DEFAULT_OVERLAY_STATE;
  return {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
}

function unusedPorts() {
  return {
    rootWatches: noRootWatches,
    tmux: {
      listPanes: () => Promise.reject(new Error('not used by this test')),
      newSession: () => Promise.reject(new Error('not used by this test')),
      respawnPane: () => Promise.reject(new Error('not used by this test')),
      killSession: () => Promise.reject(new Error('not used by this test')),
    },
    git: {
      repoRoot: () => Promise.reject(new Error('not used by this test')),
      branch: () => Promise.reject(new Error('not used by this test')),
      status: () => Promise.reject(new Error('not used by this test')),
      workTreePrefix: () => Promise.reject(new Error('not used by this test')),
    },
    configPort: {
      read: () => {
        throw new Error('not used by this test');
      },
      write: () => {
        throw new Error('not used by this test');
      },
    },
    attach: {
      attach: () => {
        throw new Error('not used by this test');
      },
    },
  };
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function receiveOne(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data: Buffer) =>
      resolve(JSON.parse(data.toString('utf8')) as ServerMessage),
    );
    socket.once('error', reject);
  });
}

function serverWithProjection() {
  return createServer({
    projection: createProjection(fakeStore()),
    store: fakeStore(),
    repos: {
      list: () => Promise.resolve([]),
      resolveRoot: () => Promise.reject(new Error('not used by this test')),
    },
    serverPort: 4310,
    settingsPath: '/home/.garden/claude-settings.json',
    readClaudeCommand: () => ['claude'],
    deadSessionCap: 10,
    terminalFontSize: 13,
    ...unusedPorts(),
  });
}

describe('WS /events against the real server', () => {
  let app: ReturnType<typeof createServer> | undefined;
  let socket: WebSocket | undefined;

  afterEach(async () => {
    socket?.close();
    await app?.close();
    app = undefined;
    socket = undefined;
  });

  it('sends a snapshot on connect, then a delta for a dispatch that follows', async () => {
    const projection = createProjection(fakeStore());
    app = createServer({
      projection,
      store: fakeStore(),
      repos: {
        list: () => Promise.resolve([]),
        resolveRoot: () => Promise.reject(new Error('not used by this test')),
      },
      serverPort: 4310,
      settingsPath: '/home/.garden/claude-settings.json',
      readClaudeCommand: () => ['claude'],
      deadSessionCap: 10,
      terminalFontSize: 13,
      ...unusedPorts(),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    socket = new WebSocket(`ws://127.0.0.1:${String(port)}/events`);
    // The server may send the snapshot the instant the connection is accepted, so the
    // 'message' listener must be attached before 'open' resolves, not after.
    const snapshotPromise = receiveOne(socket);
    await new Promise<void>((resolve, reject) => {
      socket?.once('open', resolve);
      socket?.once('error', reject);
    });

    const snapshot = await snapshotPromise;
    expect(snapshot).toEqual({ type: 'snapshot', sessions: [], uiState: projection.uiState() });

    const nextDelta = receiveOne(socket);
    projection.dispatch({
      type: 'session-registered',
      id: 'sid-1',
      tmuxName: 'a-session',
      cwd: '/tmp/a-session',
    });
    const delta = (await nextDelta) as { type: 'deltas'; deltas: Delta[] };
    expect(delta.type).toBe('deltas');
    expect(delta.deltas).toEqual([expect.objectContaining({ type: 'session-added' })]);
  });

  it('shuts down while a client is still connected', async () => {
    app = serverWithProjection();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    socket = new WebSocket(`ws://127.0.0.1:${String(port)}/events`);
    await opened(socket);
    const closed = new Promise<number>((resolve) => socket?.once('close', (code) => resolve(code)));

    // A close that waits on the client would hang here rather than fail.
    await app.close();
    app = undefined;

    expect(await closed).toBe(EVENTS_CLOSE_CODES.DELIBERATE_SHUTDOWN);
  });

  it('drops a client that sends a malformed frame and keeps serving', async () => {
    app = serverWithProjection();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    socket = new WebSocket(`ws://127.0.0.1:${String(port)}/events`);
    await opened(socket);
    const closed = new Promise<void>((resolve) => socket?.once('close', () => resolve()));
    // A masked, empty frame carrying reserved opcode 0x3.
    const raw = (socket as unknown as { _socket: Socket })._socket;
    raw.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0]));
    await closed;

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  });
});

describe('WS /events root watches against a real watcher', () => {
  let app: ReturnType<typeof createServer> | undefined;
  let dir: string;
  let repo: string;
  const sockets: WebSocket[] = [];

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-events-watch-')));
    repo = join(dir, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: repo });
    mkdirSync(join(repo, 'src'));
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app?.close();
    app = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function connect(port: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/events`);
    const messages: ServerMessage[] = [];
    socket.on('message', (data: Buffer) =>
      messages.push(JSON.parse(data.toString('utf8')) as ServerMessage),
    );
    sockets.push(socket);
    await opened(socket);
    const fsChanged = () => messages.filter((m) => m.type === 'fs-changed');
    return { socket, fsChanged };
  }

  it('sends fs-changed in the watcher spelling to the watching connection only', async () => {
    const git = { repoRoot, branch, status, workTreePrefix };
    const repos = createRepoCatalog({ git, roots: [dir] });
    const logger = { warn: () => undefined, error: () => undefined };
    app = createServer({
      projection: createProjection(fakeStore()),
      store: fakeStore(),
      repos,
      serverPort: 4310,
      settingsPath: '/home/.garden/claude-settings.json',
      readClaudeCommand: () => ['claude'],
      deadSessionCap: 10,
      terminalFontSize: 13,
      ...unusedPorts(),
      git,
      rootWatches: createRootWatches({
        watcher: { watch: (root, onChange) => watchFsRoot(root, onChange, logger) },
        repos,
        logger,
      }),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const watcher = await connect(port);
    const bystander = await connect(port);
    const unlisted = await connect(port);
    const spelling = `${repo}/`;
    watcher.socket.send(JSON.stringify({ type: 'watch', root: spelling }));
    unlisted.socket.send(JSON.stringify({ type: 'watch', root: dir }));

    // The watch is established asynchronously after the frame arrives, so arm by writing
    // probes until it signals, then drain.
    let probes = 0;
    await until(
      'the watch to be live',
      async () => {
        writeFileSync(join(repo, `probe-${String(probes)}`), 'x');
        probes += 1;
        await sleep(400);
        return watcher.fsChanged().length;
      },
      (n) => n > 0,
    );
    await settle(repo, () => watcher.fsChanged().length);
    const before = watcher.fsChanged().length;

    writeFileSync(join(repo, 'src', 'a.ts'), 'a');
    await until(
      'fs-changed',
      () => Promise.resolve(watcher.fsChanged().length),
      (n) => n > before,
    );
    await sleep(QUIET_WINDOW_MS);

    expect(watcher.fsChanged().at(-1)).toEqual({ type: 'fs-changed', root: spelling });
    expect(watcher.fsChanged().length).toBe(before + 1);
    expect(bystander.fsChanged()).toEqual([]);
    expect(unlisted.fsChanged()).toEqual([]);
  });
});
