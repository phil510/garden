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

/** `ws` ignores an upgrade whose path does not match, so `WS /attach/:id` can mount its
 *  own `WebSocketServer` on the same underlying HTTP server without conflict. */
export function registerEventsSocket(app: FastifyInstance, deps: EventsDeps): void {
  const wss = new WebSocketServer({ server: app.server, path: '/events' });
  app.addHook('onClose', (_instance, done) => wss.close(() => done()));

  wss.on('connection', (socket) => {
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
}
