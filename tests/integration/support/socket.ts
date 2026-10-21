import type { WebSocket } from 'ws';

/** Resolves once the socket is open, rejects if it errors first. */
export function opened(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}
