import type { FastifyInstance } from 'fastify';
import type { HealthStatus } from '@garden/shared';

/** Liveness only: the CLI uses a 200 here to decide whether a server is already running. */
export function healthRoutes(app: FastifyInstance) {
  app.get('/health', (): HealthStatus => ({ status: 'ok' }));
}
