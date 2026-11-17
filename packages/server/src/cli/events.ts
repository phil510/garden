import { pipeUrl } from './http.js';
import { writeAll, type WritableLike } from './io.js';
import { ownPipeSession } from './pipeIdentity.js';

/** The part of a WebSocket the loop uses; the global `WebSocket` satisfies it. */
export interface PipeSocket {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

export interface EventsFollowDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly out: WritableLike;
  readonly stderr: WritableLike;
  /** Resolves when the process holding the other end of `out` is gone. */
  readonly gone: Promise<void>;
  readonly connect?: (sessionId: string) => PipeSocket;
  /** When supplied, acknowledge only after the message has been accepted for delivery. */
  readonly forward?: (sessionId: string, line: string, signal: AbortSignal) => Promise<unknown>;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5000;

function defaultConnect(sessionId: string): PipeSocket {
  return new WebSocket(pipeUrl(sessionId));
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function parseDigest(data: unknown): { id: string; line: string } | null {
  if (typeof data !== 'string') return null;
  try {
    const message = JSON.parse(data) as { type?: unknown; id?: unknown; line?: unknown } | null;
    if (message?.type !== 'digest') return null;
    return typeof message.id === 'string' && typeof message.line === 'string'
      ? { id: message.id, line: message.line }
      : null;
  } catch {
    return null;
  }
}

/**
 * Delivers digests to stdout or the supplied forwarder before acknowledging them. Failed
 * forwards reconnect without an ack so the server retains the digest for another attempt.
 */
export async function runEventsFollow(deps: EventsFollowDeps): Promise<0> {
  const { env, out, stderr, gone } = deps;
  const connect = deps.connect ?? defaultConnect;
  const sleep = deps.sleep ?? defaultSleep;

  const sessionId = ownPipeSession(env);
  if (sessionId === null) {
    await gone;
    return 0;
  }

  const stopping = new AbortController();
  const stop = () => stopping.abort();
  void gone.then(stop);
  const stopped = new Promise<'stopped'>((resolve) =>
    stopping.signal.addEventListener('abort', () => resolve('stopped'), { once: true }),
  );

  /** A failed stdout write means Claude, the other end of the lifeline, is gone. */
  async function print(text: string): Promise<void> {
    try {
      await writeAll(out, text);
    } catch {
      stop();
    }
  }

  function attempt(socket: PipeSocket, id: string): Promise<'closed'> {
    return new Promise((resolve) => {
      let active = true;
      const closed = () => {
        active = false;
        resolve('closed');
      };
      // Serial delivery keeps an enqueue failure from acknowledging later digests.
      let queue: Promise<void> = Promise.resolve();
      socket.addEventListener('open', () => {
        backoff = MIN_BACKOFF_MS;
        reported = false;
      });
      socket.addEventListener('message', (event) => {
        queue = queue.then(async () => {
          const digest = parseDigest(event.data);
          if (digest === null || !active || stopping.signal.aborted) return;
          if (deps.forward) {
            try {
              await deps.forward(id, digest.line, stopping.signal);
            } catch {
              closed();
              return;
            }
          } else {
            await print(`${digest.line}\n`);
          }
          if (!active || stopping.signal.aborted) return;
          try {
            socket.send(JSON.stringify({ type: 'ack', id: digest.id }));
          } catch {
            // The connection dropped; the digest is resent on reconnect.
          }
        });
      });
      socket.addEventListener('close', closed);
      socket.addEventListener('error', closed);
    });
  }

  let backoff = MIN_BACKOFF_MS;
  let reported = false;
  while (!stopping.signal.aborted) {
    let socket: PipeSocket | undefined;
    try {
      socket = connect(sessionId);
      const outcome = await Promise.race([attempt(socket, sessionId), stopped]);
      if (outcome === 'stopped') break;
    } catch {
      // A connect that throws (no config, no server) is an outage like any other.
    } finally {
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
    }
    if (stopping.signal.aborted) break;
    if (!reported) {
      reported = true;
      try {
        await writeAll(stderr, 'garden: events stream disconnected; reconnecting\n');
      } catch {
        // A broken diagnostic channel does not mean Claude is gone; keep delivering digests.
      }
    }
    if (stopping.signal.aborted) break;
    await sleep(backoff, stopping.signal);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
  return 0;
}
