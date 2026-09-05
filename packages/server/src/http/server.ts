import Fastify, { type FastifyInstance } from 'fastify';
import type { HooksDeps } from '../app/hooks.js';
import { healthRoutes } from './routes/health.js';
import { hookRoutes } from './routes/hooks.js';

export type ServerDeps = HooksDeps;

/** Builds the Fastify instance and mounts the routes. Listening is main.ts's job. */
export function createServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify();
  app.register(healthRoutes);
  app.register((instance) => hookRoutes(instance, deps));
  return app;
}
