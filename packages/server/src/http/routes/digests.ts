import type { DigestResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { getDigest } from '../../app/digests.js';
import type { DigestsDeps } from '../../app/digests.js';

export function digestRoutes(app: FastifyInstance, deps: DigestsDeps) {
  app.get<{ Params: { id: string } }>('/digests/:id', (request, reply) => {
    const result: DigestResponse = { digest: getDigest(deps, request.params.id) };
    return reply.send(result);
  });
}
