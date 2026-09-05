import Fastify, { type FastifyInstance } from 'fastify';
import type { SessionsDeps } from '../app/sessions.js';
import { healthRoutes } from './routes/health.js';
import { hookRoutes } from './routes/hooks.js';
import { sessionRoutes } from './routes/sessions.js';

export type ServerDeps = SessionsDeps;

/** Builds the Fastify instance and mounts the routes. Listening is main.ts's job. */
export function createServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify();
  app.register(healthRoutes);
  app.register((instance) => hookRoutes(instance, deps));
  app.register((instance) => sessionRoutes(instance, deps));
  return app;
}
