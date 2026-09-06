import Fastify, { type FastifyInstance } from 'fastify';
import type { AttachSocketDeps } from './ws/attach.js';
import type { ReposDeps } from '../app/repos.js';
import type { SessionsDeps } from '../app/sessions.js';
import { fsRoutes } from './routes/fs.js';
import { healthRoutes } from './routes/health.js';
import { hookRoutes } from './routes/hooks.js';
import { repoRoutes } from './routes/repos.js';
import { sessionRoutes } from './routes/sessions.js';
import { uiStateRoutes } from './routes/ui-state.js';
import { registerAttachSocket } from './ws/attach.js';
import { registerEventsSocket } from './ws/events.js';

export type ServerDeps = SessionsDeps & ReposDeps & AttachSocketDeps;

/** Builds the Fastify instance and mounts the routes. Listening is main.ts's job. */
export function createServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify();
  app.register(healthRoutes);
  app.register((instance) => hookRoutes(instance, deps));
  app.register((instance) => sessionRoutes(instance, deps));
  app.register((instance) => repoRoutes(instance, deps));
  app.register((instance) => uiStateRoutes(instance, deps));
  app.register((instance) => fsRoutes(instance, deps));

  const eventsWss = registerEventsSocket(app, deps);
  const attachWss = registerAttachSocket(app, deps);
  // Both sockets share one HTTP server, so exactly one `upgrade` listener has to route
  // between them — two independent `WebSocketServer`s each listening for `upgrade` would
  // have the first one's path mismatch abort the handshake before the second ever sees it.
  app.server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '', 'http://localhost').pathname;
    if (pathname === '/events') {
      eventsWss.handleUpgrade(request, socket, head, (ws) =>
        eventsWss.emit('connection', ws, request),
      );
    } else if (pathname.startsWith('/attach/')) {
      attachWss.handleUpgrade(request, socket, head, (ws) =>
        attachWss.emit('connection', ws, request),
      );
    } else {
      socket.destroy();
    }
  });

  return app;
}
