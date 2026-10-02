import type { AddressInfo, Socket } from 'node:net';
import { EVENTS_CLOSE_CODES, type Delta, type ServerMessage } from '@garden/shared';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_STATE } from '../../src/adapters/store.js';
import { createProjection } from '../../src/app/projection.js';
import type { OverlayState, StorePort } from '../../src/app/ports.js';
import { createServer } from '../../src/http/server.js';

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
