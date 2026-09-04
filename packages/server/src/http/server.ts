import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';

/** Builds the Fastify instance and mounts the routes. Listening is main.ts's job. */
export function createServer(): FastifyInstance {
  const app = Fastify();
  app.register(healthRoutes);
  return app;
}
