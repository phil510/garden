import type { Delta, PipeServerMessage } from '@garden/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Watch } from '../domain/watches.js';
import { createPipes } from './pipes.js';
import type { OverlayState, StorePort } from './ports.js';
import { createProjection } from './projection.js';
import { updateWatches } from './watches.js';

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
  watches: [],
  digests: [],
  pipes: {},
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY_MS;

function aWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: 'w1',
    sessionId: 's1',
    repo: 'acme/widgets',
    pr: 7,
    kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
    createdAt: NOW,
    cursor: null,
    pendingDigest: null,
    status: 'active',
    ...overrides,
  };
}

const digest = (id: string, createdAt = NOW) => ({ id, line: `line ${id}`, createdAt });

/** A real projection over an in-memory store. `restart()` builds a second one over the same
 *  store, the way a server restart does. */
function setup(initial: Partial<OverlayState> = {}) {
  let overlay: OverlayState = { ...emptyOverlay, ...initial };
  const store: StorePort = {
    read: () => overlay,
    write: (state) => {
      overlay = state;
    },
  };
  const build = () => {
    const projection = createProjection(store);
    projection.dispatch({ type: 'session-registered', id: 's1', tmuxName: 's1', cwd: '/work/s1' });
    projection.dispatch({ type: 'session-registered', id: 's2', tmuxName: 's2', cwd: '/work/s2' });
    const deltas: Delta[] = [];
    projection.subscribe((batch) => deltas.push(...batch));
    const deps = { projection, git: { remoteUrl: () => Promise.resolve(null) } };
    return { projection, deps, pipes: createPipes(deps), deltas };
  };
  const first = build();
  const session = (id = 's1') => first.projection.sessions().find((s) => s.id === id);
  return { ...first, overlay: () => overlay, session, restart: build };
}

/** A fake stream: the messages it was sent, in order. */
function aStream(onSend?: (message: PipeServerMessage) => void) {
  const received: PipeServerMessage[] = [];
  const send = (message: PipeServerMessage) => {
    received.push(message);
    onSend?.(message);
  };
  return { received, send, ids: () => received.map((m) => m.id) };
}

const settle = () => Promise.resolve();

// The use cases read the clock themselves, so pin it to the test's time.
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

describe('delivery', () => {
  it('sends a digest pending with no pipe on connect, and leaves it pending until acked', () => {
    const t = setup();
    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    const stream = aStream();

    const connection = t.pipes.connect('s1', stream.send);

    expect(stream.received).toEqual([{ type: 'digest', id: 'd1', line: 'line d1' }]);
    expect(t.session()?.watches[0]?.pendingDigest).toBe(true);
    connection.ack('d1');
    expect(t.session()?.watches[0]?.pendingDigest).toBe(false);
    expect(t.overlay().watches[0]?.pendingDigest).toBeNull();
  });

  it('never clears a digest by sending alone', async () => {
    const t = setup();
    const stream = aStream();
    t.pipes.connect('s1', stream.send);

    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    await settle();

    expect(stream.ids()).toEqual(['d1']);
    expect(t.overlay().watches[0]?.pendingDigest?.id).toBe('d1');
  });

  it('resends a digest to the next connection when the first closed before acking', () => {
    const t = setup({ watches: [aWatch({ pendingDigest: digest('d1') })] });
    const first = aStream();
    t.pipes.connect('s1', first.send).close();

    const second = aStream();
    t.pipes.connect('s1', second.send);

    expect(first.ids()).toEqual(['d1']);
    expect(second.ids()).toEqual(['d1']);
  });

  it('sends a merged digest to the open connection, and a late ack of the old id leaves it pending', async () => {
    const t = setup({ watches: [aWatch({ pendingDigest: digest('d1') })] });
    const stream = aStream();
    const connection = t.pipes.connect('s1', stream.send);

    updateWatches(t.deps, (ws) => ws.map((w) => ({ ...w, pendingDigest: digest('d2') })), NOW);
    await settle();
    connection.ack('d1');

    expect(stream.ids()).toEqual(['d1', 'd2']);
    expect(t.overlay().watches[0]?.pendingDigest?.id).toBe('d2');
  });

  it('sends only the digest standing at delivery when two writes land in one synchronous block', async () => {
    const t = setup();
    const stream = aStream();
    t.pipes.connect('s1', stream.send);

    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    updateWatches(t.deps, (ws) => ws.map((w) => ({ ...w, pendingDigest: digest('d2') })), NOW);
    await settle();

    expect(stream.ids()).toEqual(['d2']);
  });

  it('does not send a digest twice to one connection', async () => {
    const t = setup({ watches: [aWatch({ pendingDigest: digest('d1') })] });
    const stream = aStream();
    t.pipes.connect('s1', stream.send);

    updateWatches(t.deps, (ws) => [...ws, aWatch({ id: 'w2', pr: 8 })], NOW);
    await settle();

    expect(stream.ids()).toEqual(['d1']);
  });

  it('sends only the connected session its own digests', () => {
    const t = setup({
      watches: [
        aWatch({ pendingDigest: digest('d1') }),
        aWatch({ id: 'w2', sessionId: 's2', pendingDigest: digest('d2') }),
      ],
    });
    const stream = aStream();
    t.pipes.connect('s2', stream.send);
    expect(stream.ids()).toEqual(['d2']);
  });

  it('sends to every connection of a session, and an ack from either clears the digest', async () => {
    const t = setup();
    const a = aStream();
    const b = aStream();
    const connectionA = t.pipes.connect('s1', a.send);
    t.pipes.connect('s1', b.send);

    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    await settle();
    connectionA.ack('d1');

    expect(a.ids()).toEqual(['d1']);
    expect(b.ids()).toEqual(['d1']);
    expect(t.overlay().watches[0]?.pendingDigest).toBeNull();
  });

  it('removes a closed watch when its final digest is acked', () => {
    const t = setup();
    updateWatches(t.deps, () => [aWatch({ status: 'closed', pendingDigest: digest('d1') })], NOW);
    const connection = t.pipes.connect('s1', aStream().send);

    connection.ack('d1');

    expect(t.overlay().watches).toEqual([]);
    expect(t.session()?.watches).toEqual([]);
  });

  it('ends with no pending digest when a send acks synchronously', async () => {
    const t = setup();
    const acks: ((id: string) => void)[] = [];
    const stream = aStream((message) => acks.forEach((ack) => ack(message.id)));
    const connection = t.pipes.connect('s1', stream.send);
    acks.push((id) => connection.ack(id));

    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    await settle();

    expect(stream.ids()).toEqual(['d1']);
    expect(t.session()?.watches[0]?.pendingDigest).toBe(false);
    expect(t.overlay().watches[0]?.pendingDigest).toBeNull();
  });

  it('delivers from the written overlay without reading the store again', async () => {
    const t = setup();
    const stream = aStream();
    t.pipes.connect('s1', stream.send);
    vi.spyOn(t.projection, 'overlay').mockImplementation(() => {
      throw new Error('state.json is unreadable');
    });

    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    await settle();

    expect(stream.ids()).toEqual(['d1']);
  });

  it('still dispatches the writer’s watches-changed when a send throws', async () => {
    const t = setup();
    t.pipes.connect('s1', () => {
      throw new Error('socket closed');
    });

    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    await settle();

    expect(t.session()?.watches[0]?.pendingDigest).toBe(true);
  });
});

describe('connection state', () => {
  it('leaves no registered connection when persisting the connect throws', async () => {
    const t = setup();
    const failing = vi.spyOn(t.projection, 'updateOverlay').mockImplementationOnce(() => {
      throw new Error('state.json is not writable');
    });
    const stream = aStream();

    expect(() => t.pipes.connect('s1', stream.send)).toThrow('not writable');
    failing.mockRestore();
    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    await settle();
    t.pipes.sweep(NOW + 1);

    expect(stream.received).toEqual([]);
    expect(t.session()?.pipeConnected).toBeFalsy();
    expect(t.overlay().pipes).toEqual({});
  });

  it('dispatches pipe-changed on the first connect and the last disconnect only', () => {
    const t = setup();
    const changes = () =>
      t.deltas.filter(
        (d) => d.type === 'session-changed' && 'pipeConnected' in d.changes && d.id === 's1',
      ).length;

    const a = t.pipes.connect('s1', aStream().send);
    const b = t.pipes.connect('s1', aStream().send);
    expect(t.session()?.pipeConnected).toBe(true);
    expect(changes()).toBe(1);

    a.close();
    expect(t.session()?.pipeConnected).toBe(true);
    b.close();
    expect(t.session()?.pipeConnected).toBe(false);
    expect(changes()).toBe(2);
  });

  it('treats a repeated close as one', () => {
    const t = setup();
    const a = t.pipes.connect('s1', aStream().send);
    const b = t.pipes.connect('s1', aStream().send);
    a.close();
    a.close();
    expect(t.session()?.pipeConnected).toBe(true);
    b.close();
    expect(t.session()?.pipeConnected).toBe(false);
  });

  it('persists the time on connect and on disconnect', () => {
    const t = setup();
    const connection = t.pipes.connect('s1', aStream().send);
    expect(t.overlay().pipes).toEqual({ s1: NOW });
    expect(t.session()?.pipeLastConnectedAt).toBe(NOW);

    vi.spyOn(Date, 'now').mockReturnValue(NOW + 5);
    connection.close();
    expect(t.overlay().pipes).toEqual({ s1: NOW + 5 });
    expect(t.session()?.pipeLastConnectedAt).toBe(NOW + 5);
  });
});

describe('sweep', () => {
  it('ends a watch of a session with no pipe for seven days and leaves a connected one alone', () => {
    const old = NOW - 8 * DAY_MS;
    const t = setup({
      watches: [aWatch({ createdAt: old }), aWatch({ id: 'w2', sessionId: 's2', createdAt: old })],
    });
    t.pipes.connect('s2', aStream().send);

    t.pipes.sweep(NOW);

    expect(t.overlay().watches.map((w) => w.sessionId)).toEqual(['s2']);
    expect(t.session('s1')?.watches).toEqual([]);
  });

  it('leaves the watch of a session that never connected alone until it is seven days old', () => {
    const t = setup({ watches: [aWatch({ createdAt: NOW - 6 * DAY_MS })] });
    t.pipes.sweep(NOW);
    expect(t.overlay().watches).toHaveLength(1);
  });

  it('refreshes the time of a connected session and dispatches pipe-changed for it', () => {
    const t = setup();
    t.pipes.connect('s1', aStream().send);

    t.pipes.sweep(NOW + DAY_MS);

    expect(t.overlay().pipes).toEqual({ s1: NOW + DAY_MS });
    expect(t.session()).toMatchObject({ pipeConnected: true, pipeLastConnectedAt: NOW + DAY_MS });
  });

  it('prunes stale times and clears them from the projection', () => {
    const t = setup({ pipes: { s1: NOW - 8 * DAY_MS, s2: NOW - DAY_MS } });
    t.pipes.replay();

    t.pipes.sweep(NOW);

    expect(t.overlay().pipes).toEqual({ s2: NOW - DAY_MS });
    expect(t.session('s1')?.pipeLastConnectedAt).toBeNull();
    expect(t.session('s2')?.pipeLastConnectedAt).toBe(NOW - DAY_MS);
  });

  it('uses the persisted time after a restart', () => {
    const t = setup({ watches: [aWatch({ createdAt: NOW - 30 * DAY_MS })] });
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 2 * DAY_MS);
    t.pipes.connect('s1', aStream().send).close();

    const restarted = t.restart();
    restarted.pipes.replay();
    restarted.pipes.sweep(NOW);

    expect(t.overlay().watches).toHaveLength(1);
    expect(restarted.projection.sessions().find((s) => s.id === 's1')).toMatchObject({
      pipeConnected: false,
      pipeLastConnectedAt: NOW - 2 * DAY_MS,
    });
  });
});

describe('replay', () => {
  it('projects every persisted time as disconnected', () => {
    const t = setup({ pipes: { s1: 42 } });
    t.pipes.replay();
    expect(t.session()).toMatchObject({ pipeConnected: false, pipeLastConnectedAt: 42 });
  });
});
