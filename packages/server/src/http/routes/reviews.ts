import type { ErrorResponse, StartReviewSessionResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import type { ReviewDismisser } from '../../app/reviewDismiss.js';
import type { ReviewSessions } from '../../app/reviewSessions.js';

export interface ReviewsDeps {
  readonly reviewDismisser: ReviewDismisser;
}

export interface ReviewRoutesDeps extends ReviewsDeps {
  readonly sessions: ReviewSessions;
}

type ReviewParams = { Params: { owner: string; name: string; number: string } };

export function reviewRoutes(app: FastifyInstance, deps: ReviewRoutesDeps) {
  app.post<ReviewParams>('/reviews/:owner/:name/:number/session', async (request, reply) => {
    const { owner, name, number } = request.params;
    const pr = Number(number);
    if (!/^\d+$/.test(number) || !Number.isSafeInteger(pr) || pr < 1)
      return reply
        .code(400)
        .send({ error: 'number must be a positive integer' } satisfies ErrorResponse);
    const result: StartReviewSessionResponse = await deps.sessions.start(owner, name, pr);
    return reply.send(result);
  });

  app.post<ReviewParams>('/reviews/:owner/:name/:number/dismiss', async (request, reply) => {
    const { owner, name, number } = request.params;
    const pr = Number(number);
    if (!/^\d+$/.test(number) || !Number.isSafeInteger(pr) || pr <= 0)
      return reply.code(400).send({ error: 'invalid pull request number' } satisfies ErrorResponse);
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
  });
}
