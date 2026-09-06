import type { AddressInfo } from 'node:net';
import type { Delta, UiState } from '@garden/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { Projection } from '../../app/projection.js';
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
  hideDead: false,
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
  preset: 'single',
  slots: [null],
  focusedSlot: 0,
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
  };
  return { projection, listeners, uiListeners };
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
    registerEventsSocket(app, { projection });
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
});
