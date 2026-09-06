import type { AddressInfo } from 'node:net';
import type { Delta, ServerMessage } from '@garden/shared';
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
    },
  };
}

function receiveOne(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data: Buffer) =>
      resolve(JSON.parse(data.toString('utf8')) as ServerMessage),
    );
    socket.once('error', reject);
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
      roots: [],
      serverPort: 4310,
      settingsPath: '/home/.garden/claude-settings.json',
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
});
