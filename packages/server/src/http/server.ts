import Fastify, { type FastifyInstance } from 'fastify';
import type { ReposDeps } from '../app/repos.js';
import type { SessionsDeps } from '../app/sessions.js';
import { healthRoutes } from './routes/health.js';
import { hookRoutes } from './routes/hooks.js';
import { repoRoutes } from './routes/repos.js';
import { sessionRoutes } from './routes/sessions.js';
import { uiStateRoutes } from './routes/ui-state.js';

export type ServerDeps = SessionsDeps & ReposDeps;

/** Builds the Fastify instance and mounts the routes. Listening is main.ts's job. */
export function createServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify();
  app.register(healthRoutes);
  app.register((instance) => hookRoutes(instance, deps));
  app.register((instance) => sessionRoutes(instance, deps));
  app.register((instance) => repoRoutes(instance, deps));
  app.register((instance) => uiStateRoutes(instance, deps));
  return app;
}
