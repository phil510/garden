import type { ErrorResponse, StartReviewSessionResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import type { ReviewSessions } from '../../app/reviewSessions.js';

export function reviewRoutes(app: FastifyInstance, sessions: ReviewSessions) {
  app.post<{ Params: { owner: string; name: string; number: string } }>(
    '/reviews/:owner/:name/:number/session',
    async (request, reply) => {
      const { owner, name, number } = request.params;
      const pr = Number(number);
      if (!/^\d+$/.test(number) || !Number.isSafeInteger(pr) || pr < 1)
        return reply
          .code(400)
          .send({ error: 'number must be a positive integer' } satisfies ErrorResponse);
      const result: StartReviewSessionResponse = await sessions.start(owner, name, pr);
      return reply.send(result);
    },
  );
}
