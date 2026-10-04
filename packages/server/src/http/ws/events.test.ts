import type { AddressInfo } from 'node:net';
import { EVENTS_CLOSE_CODES, type Delta, type UiState } from '@garden/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { Projection } from '../../app/projection.js';
import type { RootWatches } from '../../app/rootWatch.js';
import { registerEventsSocket } from './events.js';

/** Polls until `predicate` holds or the deadline passes, failing with the last observation. */
async function until<T>(
  probe: () => T,
  predicate: (value: T) => boolean,
  description: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = probe();
  while (!predicate(last)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${description}. Last observation: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    last = probe();
  }
  return last;
}

const UI_STATE: UiState = {
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
  hideDeadRepos: [],
  preset: 'single',
  slots: [null],
  focusedSlot: 0,
  layout: null,
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
};

function fakeProjection() {
  const listeners = new Set<(deltas: Delta[]) => void>();
  const uiListeners = new Set<(uiState: UiState) => void>();
  const projection: Projection = {
    sessions: () => [],
    uiState: () => UI_STATE,
    dispatch: () => undefined,
    updateUiState: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeUiState: (listener) => {
      uiListeners.add(listener);
      return () => uiListeners.delete(listener);
    },
    overlay: () => {
      throw new Error('not used by this test');
    },
    updateOverlay: () => {
      throw new Error('not used by this test');
    },
    subscribeOverlay: () => () => undefined,
    placementOf: () => {
      throw new Error('not used by this test');
    },
  };
  return { projection, listeners, uiListeners };
}

/** Records the roots a connection asked to watch and how many connections are still open. */
function fakeRootWatches() {
  const watched: string[] = [];
  const state = { open: 0 };
  const rootWatches: RootWatches = {
    connect: () => {
      state.open += 1;
      return {
        watch: (root) => {
          watched.push(root);
          return Promise.resolve();
        },
        close: () => {
          state.open -= 1;
        },
      };
    },
  };
  return { rootWatches, watched, state };
}

describe('registerEventsSocket', () => {
  let app: FastifyInstance | undefined;
  let socket: WebSocket | undefined;

  afterEach(async () => {
    socket?.close();
    await app?.close();
    app = undefined;
    socket = undefined;
  });

  it('unsubscribes from both the delta and ui-state feeds once the socket closes', async () => {
    const { projection, listeners, uiListeners } = fakeProjection();
    app = Fastify();
    const wss = registerEventsSocket(app, {
      projection,
      rootWatches: fakeRootWatches().rootWatches,
    });
    // `registerEventsSocket` runs in `noServer` mode; production wiring of the shared
    // `upgrade` listener lives in `http/server.ts`, so this standalone test does it too.
    app.server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    socket = new WebSocket(`ws://127.0.0.1:${String(port)}/events`);
    // The server may send the snapshot the instant the connection is accepted, so the
    // 'message' listener must be attached before 'open' resolves, not after.
    const firstMessage = new Promise<void>((resolve) => socket?.once('message', () => resolve()));
    await new Promise<void>((resolve, reject) => {
      socket?.once('open', resolve);
      socket?.once('error', reject);
    });
    await firstMessage;

    expect(listeners.size).toBe(1);
    expect(uiListeners.size).toBe(1);

    socket.close();

    await until(
      () => listeners.size,
      (size) => size === 0,
      'the delta subscription to be dropped after close',
    );
    await until(
      () => uiListeners.size,
      (size) => size === 0,
      'the ui-state subscription to be dropped after close',
    );
  });

  it('sends the deliberate-shutdown close code before app.close() resolves', async () => {
    const { projection } = fakeProjection();
    app = Fastify();
    const wss = registerEventsSocket(app, {
      projection,
      rootWatches: fakeRootWatches().rootWatches,
    });
    app.server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    socket = new WebSocket(`ws://127.0.0.1:${String(port)}/events`);
    const firstMessage = new Promise<void>((resolve) => socket?.once('message', () => resolve()));
    await new Promise<void>((resolve, reject) => {
      socket?.once('open', resolve);
      socket?.once('error', reject);
    });
    await firstMessage;

    const closed = new Promise<number>((resolve) => socket?.once('close', (code) => resolve(code)));

    // A close that waits on the client would hang here rather than resolve.
    await app.close();
    app = undefined;

    expect(await closed).toBe(EVENTS_CLOSE_CODES.DELIBERATE_SHUTDOWN);
  });

  it('hands a watch frame to the root watch and ignores malformed or other frames', async () => {
    const { projection } = fakeProjection();
    const { rootWatches, watched, state } = fakeRootWatches();
    app = Fastify();
    const wss = registerEventsSocket(app, { projection, rootWatches });
    app.server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    socket = new WebSocket(`ws://127.0.0.1:${String(port)}/events`);
    const firstMessage = new Promise<void>((resolve) => socket?.once('message', () => resolve()));
    await new Promise<void>((resolve, reject) => {
      socket?.once('open', resolve);
      socket?.once('error', reject);
    });
    await firstMessage;

    socket.send('not json');
    socket.send(JSON.stringify({ type: 'resize', cols: 1, rows: 1 }));
    socket.send(JSON.stringify({ type: 'watch', root: 7 }));
    socket.send(Buffer.from([1, 2, 3]));
    socket.send(JSON.stringify({ type: 'watch', root: '/repo/a' }));

    await until(
      () => watched,
      (roots) => roots.length > 0,
      'the watch frame to reach the root watch',
    );
    expect(watched).toEqual(['/repo/a']);
    expect(socket.readyState).toBe(WebSocket.OPEN);

    socket.close();
    await until(
      () => state.open,
      (open) => open === 0,
      'the root watch to be released after close',
    );
  });
});
