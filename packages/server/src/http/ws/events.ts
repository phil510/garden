import type { ServerMessage } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Projection } from '../../app/projection.js';

export interface EventsDeps {
  readonly projection: Projection;
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

/** `noServer` mode: `http/server.ts` owns the single `upgrade` listener on the shared HTTP
 *  server and dispatches to this `wss` by path, so it can also dispatch to `WS /attach/:id`. */
export function registerEventsSocket(app: FastifyInstance, deps: EventsDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  // An upgraded socket keeps the HTTP server from closing, and that happens before `onClose`
  // runs — so the clients have to go in `preClose`. `wss.close()` terminates none of them itself.
  app.addHook('preClose', () => {
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
