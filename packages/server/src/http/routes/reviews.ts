import type { ErrorResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import type { ReviewDismisser } from '../../app/reviewDismiss.js';

export interface ReviewsDeps {
  readonly reviewDismisser: ReviewDismisser;
}

export function reviewRoutes(app: FastifyInstance, deps: ReviewsDeps) {
  app.post<{ Params: { owner: string; name: string; number: string } }>(
    '/reviews/:owner/:name/:number/dismiss',
    async (request, reply) => {
      const { owner, name, number } = request.params;
      const pr = Number(number);
      if (!/^\d+$/.test(number) || !Number.isSafeInteger(pr) || pr <= 0)
        return reply
          .code(400)
          .send({ error: 'invalid pull request number' } satisfies ErrorResponse);
      const outcome = await deps.reviewDismisser.dismiss(`${owner}/${name}`, pr);
      switch (outcome.kind) {
        case 'dismissed':
          return reply.code(204).send();
        case 'invalid-repo':
          return reply.code(400).send({ error: 'invalid repo' } satisfies ErrorResponse);
        case 'not-found':
          return reply.code(404).send({ error: 'not in the review queue' } satisfies ErrorResponse);
        case 'failed':
          return reply.code(502).send(outcome.failure);
      }
    },
  );
}
