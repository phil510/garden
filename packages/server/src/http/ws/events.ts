import { EVENTS_CLOSE_CODES, type ServerMessage } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Projection } from '../../app/projection.js';

export interface EventsDeps {
  readonly projection: Projection;
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

// A graceful `close()` needs the other end to finish its handshake, which is not guaranteed
// to happen — this is how long `preClose` waits before giving up and terminating stragglers.
const SHUTDOWN_GRACE_PERIOD_MS = 50;

/** `noServer` mode: `http/server.ts` owns the single `upgrade` listener on the shared HTTP
 *  server and dispatches to this `wss` by path, so it can also dispatch to `WS /attach/:id`. */
export function registerEventsSocket(app: FastifyInstance, deps: EventsDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  // An upgraded socket keeps the HTTP server from closing, and that happens before `onClose`
  // runs — so the clients have to go in `preClose`. `wss.close()` terminates none of them itself.
  //
  // The deliberate-shutdown code has to actually reach the client, not race an abrupt
  // `terminate()` — so this sends a real close frame to every client first, then gives the
  // handshake a short grace period before terminating whatever is still open. `app.close()`
  // awaits whatever `preClose` returns, so a hung client still can't block shutdown forever.
  app.addHook('preClose', async () => {
    for (const client of wss.clients) {
      client.close(EVENTS_CLOSE_CODES.DELIBERATE_SHUTDOWN, 'garden server is shutting down');
    }
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_PERIOD_MS));
    for (const client of wss.clients) client.terminate();
  });
  app.addHook('onClose', (_instance, done) => wss.close(() => done()));

  wss.on('connection', (socket) => {
    // A malformed frame emits `error` on the socket, which is fatal to the process if unhandled.
    socket.on('error', () => socket.terminate());
    send(socket, {
      type: 'snapshot',
      sessions: deps.projection.sessions(),
      uiState: deps.projection.uiState(),
    });
    const unsubscribe = deps.projection.subscribe((deltas) => {
      send(socket, { type: 'deltas', deltas });
    });
    const unsubscribeUiState = deps.projection.subscribeUiState((uiState) => {
      send(socket, { type: 'ui-state', uiState });
    });
    socket.on('close', () => {
      unsubscribe();
      unsubscribeUiState();
    });
  });

  return wss;
}
