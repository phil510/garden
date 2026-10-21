import type { FastifyInstance } from 'fastify';
import type { HealthStatus } from '@garden/shared';

/** Liveness plus identity: the CLI matches the reported pid against `server.pid` to confirm the
 *  recorded process is this server and not an unrelated one that reused its pid. */
export function healthRoutes(app: FastifyInstance) {
  app.get('/health', (): HealthStatus => ({ status: 'ok', pid: process.pid }));
}
