import type {
  ClaimReviewRequest,
  ClaimReviewResponse,
  ErrorResponse,
  StartReviewSessionResponse,
} from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import type { ReviewDismisser } from '../../app/reviewDismiss.js';
import type { ReviewSessions } from '../../app/reviewSessions.js';
import type { ReviewStore } from '../../app/reviews.js';

export interface ReviewsDeps {
  readonly reviewDismisser: ReviewDismisser;
}

export interface ReviewRoutesDeps extends ReviewsDeps {
  readonly sessions: ReviewSessions;
  readonly reviews: Pick<ReviewStore, 'queue'>;
}

type ReviewParams = { Params: { owner: string; name: string; number: string } };

/** The pull request number from a path segment, or undefined when it is not a positive integer. */
function parsePrNumber(segment: string): number | undefined {
  const pr = Number(segment);
  return /^\d+$/.test(segment) && Number.isSafeInteger(pr) && pr >= 1 ? pr : undefined;
}

const invalidNumber = { error: 'number must be a positive integer' } satisfies ErrorResponse;

export function reviewRoutes(app: FastifyInstance, deps: ReviewRoutesDeps) {
  app.get('/reviews', (_request, reply) => reply.send(deps.reviews.queue()));

  app.post<ReviewParams>('/reviews/:owner/:name/:number/session', async (request, reply) => {
    const { owner, name, number } = request.params;
    const pr = parsePrNumber(number);
    if (pr === undefined) return reply.code(400).send(invalidNumber);
    const result: StartReviewSessionResponse = await deps.sessions.start(owner, name, pr);
    return reply.send(result);
  });

  app.post<ReviewParams & { Body: Partial<ClaimReviewRequest> | null }>(
    '/reviews/:owner/:name/:number/claim',
    (request, reply) => {
      const { owner, name, number } = request.params;
      const pr = parsePrNumber(number);
      if (pr === undefined) return reply.code(400).send(invalidNumber);
      const sessionId = request.body?.sessionId;
      if (typeof sessionId !== 'string' || sessionId === '')
        return reply.code(400).send({ error: 'sessionId is required' } satisfies ErrorResponse);
      const result: ClaimReviewResponse = deps.sessions.claim(owner, name, pr, sessionId);
      return reply.send(result);
    },
  );

  app.post<ReviewParams>('/reviews/:owner/:name/:number/dismiss', async (request, reply) => {
    const { owner, name, number } = request.params;
    const pr = parsePrNumber(number);
    if (pr === undefined) return reply.code(400).send(invalidNumber);
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
