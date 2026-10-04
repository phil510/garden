import type { PipeServerMessage } from '@garden/shared';
import { ackDigest, endUnpipedWatches, prunePipeTimes } from '../domain/pipes.js';
import type { Watch } from '../domain/watches.js';
import type { OverlayState } from './ports.js';
import { updateWatches } from './watches.js';
import type { WatchesDeps } from './watches.js';

export interface PipeConnection {
  /** Clears the digest with this id, if it is still the one pending. */
  ack(id: string): void;
  close(): void;
}

export interface Pipes {
  /** Registers an open stream for a session and sends it every digest pending for that
   *  session; later digests, including a merge that replaces one, follow as they are written. */
  connect(sessionId: string, send: (message: PipeServerMessage) => void): PipeConnection;
  /** The periodic lifecycle pass: refreshes the connection time of connected sessions, ends
   *  watches whose session has had no pipe for seven days, and prunes stale times. */
  sweep(now: number): void;
  /** Boot: tells the projection every persisted connection time, with no pipe connected. */
  replay(): void;
}

interface Connection {
  readonly sessionId: string;
  readonly send: (message: PipeServerMessage) => void;
  /** Digest ids this connection has sent and not yet seen cleared. Connection-local and never
   *  persisted, so a new connection resends everything still pending. */
  readonly sent: Set<string>;
}

/**
 * The registry of open per-session pipe streams. A digest is cleared only by an ack from a
 * stream that printed it, so one that was sent but never acked is sent again to the next
 * connection: delivery is at least once. Watches are only ever written through
 * `updateWatches`; connection times go through `projection.updateOverlay`.
 */
export function createPipes(deps: WatchesDeps): Pipes {
  const { projection } = deps;
  const connections = new Map<string, Set<Connection>>();

  function deliver(connection: Connection, watches: readonly Watch[]): void {
    const pending = new Set<string>();
    for (const watch of watches) {
      if (watch.sessionId !== connection.sessionId || watch.pendingDigest === null) continue;
      const { id, line } = watch.pendingDigest;
      pending.add(id);
      if (connection.sent.has(id)) continue;
      try {
        connection.send({ type: 'digest', id, line });
        connection.sent.add(id);
      } catch {
        // A stream that cannot be written to is closing; the digest stays unsent on it.
      }
    }
    for (const id of connection.sent) if (!pending.has(id)) connection.sent.delete(id);
  }

  // The listener fires inside `updateWatches`, before its writer dispatches `watches-changed`.
  // Delivering inline would let a throwing send escape through that writer, and a send that
  // acks at once would nest a second `updateWatches` whose dispatch the outer one overwrites.
  // The deferred pass delivers the newest overlay the listener was handed, so writes made in
  // one synchronous block deliver only the last, and it never reads the store.
  let latest: OverlayState | undefined;
  projection.subscribeOverlay((next) => {
    latest = next;
    queueMicrotask(() => {
      if (connections.size === 0 || latest === undefined) return;
      const { watches } = latest;
      for (const set of connections.values())
        for (const connection of set) deliver(connection, watches);
    });
  });

  function recordConnection(sessionIds: readonly string[], connected: boolean, now: number): void {
    if (sessionIds.length === 0) return;
    projection.updateOverlay((base) => ({
      ...base,
      pipes: { ...base.pipes, ...Object.fromEntries(sessionIds.map((id) => [id, now])) },
    }));
    for (const sessionId of sessionIds)
      projection.dispatch({ type: 'pipe-changed', sessionId, connected, lastConnectedAt: now });
  }

  return {
    connect(sessionId, send) {
      const connection: Connection = { sessionId, send, sent: new Set() };
      const open = connections.get(sessionId) ?? new Set<Connection>();
      connections.set(sessionId, open);
      open.add(connection);
      try {
        if (open.size === 1) recordConnection([sessionId], true, Date.now());
        deliver(connection, projection.overlay().watches);
      } catch (error) {
        // A connect that throws is never handed back, so nothing would ever close it.
        open.delete(connection);
        if (open.size === 0) connections.delete(sessionId);
        throw error;
      }

      let closed = false;
      return {
        ack(id) {
          updateWatches(deps, (watches) => ackDigest(watches, sessionId, id), Date.now());
        },
        close() {
          if (closed) return;
          closed = true;
          open.delete(connection);
          if (open.size > 0) return;
          connections.delete(sessionId);
          recordConnection([sessionId], false, Date.now());
        },
      };
    },

    sweep(now) {
      const connected = new Set(connections.keys());
      recordConnection([...connected], true, now);
      const { pipes } = projection.overlay();
      updateWatches(deps, (watches) => endUnpipedWatches(watches, pipes, connected, now), now);
      let dropped: string[] = [];
      projection.updateOverlay((base) => {
        const kept = prunePipeTimes(base.pipes, connected, now);
        if (kept === base.pipes) return base;
        dropped = Object.keys(base.pipes).filter((id) => !(id in kept));
        return { ...base, pipes: kept };
      });
      for (const sessionId of dropped)
        projection.dispatch({
          type: 'pipe-changed',
          sessionId,
          connected: false,
          lastConnectedAt: null,
        });
    },

    replay() {
      for (const [sessionId, lastConnectedAt] of Object.entries(projection.overlay().pipes))
        projection.dispatch({ type: 'pipe-changed', sessionId, connected: false, lastConnectedAt });
    },
  };
}
