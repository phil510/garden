import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from './errors.js';
import { fastifyLogger } from './logger.js';
import type { AttachSocketDeps } from './ws/attach.js';
import type { FilesystemDeps } from '../app/filesystem.js';
import type { Logger } from '../app/ports.js';
import type { RepoCatalog } from '../app/repoCatalog.js';
import type { SessionsDeps } from '../app/sessions.js';
import type { SwarmsDeps } from '../app/swarms.js';
import type { WatchesDeps } from '../app/watches.js';
import { fsRoutes } from './routes/fs.js';
import { healthRoutes } from './routes/health.js';
import { hookRoutes } from './routes/hooks.js';
import { repoRoutes } from './routes/repos.js';
import { sessionRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import type { SettingsDeps } from './routes/settings.js';
import { swarmRoutes } from './routes/swarms.js';
import { uiStateRoutes } from './routes/ui-state.js';
import { watchRoutes } from './routes/watches.js';
import { registerStaticRoutes, resolveClientDir } from './static.js';
import { registerAttachSocket } from './ws/attach.js';
import { registerEventsSocket, type EventsDeps } from './ws/events.js';
import { pipeSessionId, registerPipeSocket, type PipeDeps } from './ws/pipe.js';

export type ServerDeps = SessionsDeps & { readonly repos: RepoCatalog } & FilesystemDeps &
  AttachSocketDeps &
  EventsDeps &
  PipeDeps &
  SettingsDeps &
  SwarmsDeps &
  WatchesDeps;

/** Keeps every other `createServer(...)` call site (tests that don't care about logging)
 *  working unchanged — only `main.ts` and tests that assert logging behavior pass a real one. */
const noopLogger: Logger = { warn: () => undefined, error: () => undefined };

/** A Fastify instance with the logger and the error handler every route inherits. Routes
 *  and everything else are `createServer`'s to mount. */
export function createApp(logger: Logger = noopLogger): FastifyInstance {
  const app = Fastify({ loggerInstance: fastifyLogger(logger) });
  app.setErrorHandler(errorHandler);
  return app;
}

/** Builds the Fastify instance and mounts the routes. Listening is main.ts's job. */
export function createServer(deps: ServerDeps, logger: Logger = noopLogger): FastifyInstance {
  const app = createApp(logger);
  app.register(healthRoutes);
  app.register((instance) => hookRoutes(instance, deps));
  app.register((instance) => sessionRoutes(instance, deps));
  app.register((instance) => repoRoutes(instance, deps));
  app.register((instance) => settingsRoutes(instance, deps));
  app.register((instance) => uiStateRoutes(instance, deps));
  app.register((instance) => swarmRoutes(instance, deps));
  app.register((instance) => watchRoutes(instance, deps));
  app.register((instance) => fsRoutes(instance, deps));

  const clientDir = resolveClientDir(dirname(fileURLToPath(import.meta.url)));
  registerStaticRoutes(app, clientDir);

  const eventsWss = registerEventsSocket(app, deps);
  const attachWss = registerAttachSocket(app, deps);
  const pipeWss = registerPipeSocket(app, deps);
  // All sockets share one HTTP server, so exactly one `upgrade` listener has to route
  // between them: independent `WebSocketServer`s each listening for `upgrade` would
  // have the first one's path mismatch abort the handshake before the second ever sees it.
  app.server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '', 'http://localhost').pathname;
    if (pathname === '/events') {
      eventsWss.handleUpgrade(request, socket, head, (ws) =>
        eventsWss.emit('connection', ws, request),
      );
    } else if (pipeSessionId(pathname) !== undefined) {
      pipeWss.handleUpgrade(request, socket, head, (ws) => pipeWss.emit('connection', ws, request));
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
