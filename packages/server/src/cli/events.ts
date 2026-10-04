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
 * Prints each digest line the server pushes for this pipe's own session, acking it only after
 * the line is written, and reconnects for ever when the connection drops. It returns only when
 * `gone` resolves or a write to `out` or `stderr` fails, both of which mean the Claude process
 * holding the other end is gone. A monitor whose command exits stays dead until Claude
 * restarts, so nothing else ends it. `out` carries digest lines and nothing else.
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

  /** A failed write means the other end is gone. */
  async function write(stream: WritableLike, text: string): Promise<void> {
    try {
      await writeAll(stream, text);
    } catch {
      stop();
    }
  }

  function attempt(socket: PipeSocket): Promise<'closed'> {
    return new Promise((resolve) => {
      // Messages are handled one at a time so a digest is printed, then acked, in order.
      let queue: Promise<void> = Promise.resolve();
      socket.addEventListener('open', () => {
        backoff = MIN_BACKOFF_MS;
        reported = false;
      });
      socket.addEventListener('message', (event) => {
        queue = queue.then(async () => {
          const digest = parseDigest(event.data);
          if (digest === null) return;
          await write(out, `${digest.line}\n`);
          if (stopping.signal.aborted) return;
          try {
            socket.send(JSON.stringify({ type: 'ack', id: digest.id }));
          } catch {
            // The connection dropped; the digest is resent on reconnect.
          }
        });
      });
      socket.addEventListener('close', () => resolve('closed'));
      socket.addEventListener('error', () => resolve('closed'));
    });
  }

  let backoff = MIN_BACKOFF_MS;
  let reported = false;
  while (!stopping.signal.aborted) {
    let socket: PipeSocket | undefined;
    try {
      socket = connect(sessionId);
      const outcome = await Promise.race([attempt(socket), stopped]);
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
      await write(stderr, 'garden: events stream disconnected; reconnecting\n');
    }
    if (stopping.signal.aborted) break;
    await sleep(backoff, stopping.signal);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
  return 0;
}
