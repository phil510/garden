import { fstatSync } from 'node:fs';
import { Socket } from 'node:net';
import { MessageChannel } from 'node:worker_threads';
import type { WritableLike } from './io.js';

export interface Lifeline {
  /** Where digest lines go. */
  readonly out: WritableLike;
  /** Resolves when the process on the other end of `out` is gone. Never rejects. */
  readonly gone: Promise<void>;
}

/**
 * A monitor's stdout is one end of a socketpair whose other end the Claude process holds, so
 * a read on fd 1 reaches EOF the moment Claude dies, even from SIGKILL. That EOF is how the
 * pipe learns it is orphaned, so fd 1 is wrapped once as a duplex socket: writes carry digests,
 * the read side carries the death signal and keeps the event loop alive with no timer.
 *
 * Any other stdout (a terminal, a pipeline, a file) has no Claude to die with; signals end the
 * process, and a ref'd port that never wakes holds the loop open. Signals are left to Node's
 * defaults, which terminate the process.
 */
export function openLifeline(): Lifeline {
  if (fstatSync(1).isSocket()) {
    const socket = new Socket({ fd: 1, readable: true, writable: true });
    socket.on('data', () => undefined);
    const gone = new Promise<void>((resolve) => {
      for (const event of ['end', 'close', 'error']) socket.on(event, () => resolve());
    });
    return { out: socket, gone };
  }
  const { port1 } = new MessageChannel();
  port1.on('message', () => undefined);
  port1.ref();
  // A reader that closes early (`| head`) surfaces as EPIPE here; with no listener that is a crash.
  process.stdout.on('error', () => undefined);
  return { out: process.stdout, gone: new Promise<void>(() => undefined) };
}
