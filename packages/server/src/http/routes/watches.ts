import { isWatchKind } from '@garden/shared';
import type {
  AddWatchRequest,
  ErrorResponse,
  OkResponse,
  WatchesResponse,
  WatchResponse,
} from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { isRepoName } from '../../domain/watches.js';
import { addWatch, listWatches, removeWatch } from '../../app/watches.js';
import type { WatchesDeps } from '../../app/watches.js';

const isPrNumber = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

function isAddWatchRequest(body: unknown): body is AddWatchRequest {
  if (typeof body !== 'object' || body === null) return false;
  const { pr, repo, kinds } = body as Record<string, unknown>;
  return (
    isPrNumber(pr) &&
    (repo === undefined || (typeof repo === 'string' && isRepoName(repo))) &&
    (kinds === undefined || (Array.isArray(kinds) && kinds.every(isWatchKind)))
  );
}

export function watchRoutes(app: FastifyInstance, deps: WatchesDeps) {
  app.get<{ Params: { id: string } }>('/sessions/:id/watches', (request, reply) => {
    const result: WatchesResponse = { watches: listWatches(deps, request.params.id) };
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/watches', async (request, reply) => {
    if (!isAddWatchRequest(request.body))
      return reply.code(400).send({ error: 'invalid add-watch request' } satisfies ErrorResponse);
    const { pr, repo, kinds } = request.body;
    const watch = await addWatch(deps, {
      sessionId: request.params.id,
      pr,
      ...(repo === undefined ? {} : { repo }),
      ...(kinds === undefined ? {} : { kinds }),
    });
    return reply.send({ watch } satisfies WatchResponse);
  });

  app.delete<{ Params: { id: string }; Querystring: { pr?: string; repo?: string } }>(
    '/sessions/:id/watches',
    (request, reply) => {
      const { pr: rawPr, repo } = request.query;
      const pr = rawPr !== undefined && /^\d+$/.test(rawPr) ? Number(rawPr) : undefined;
      if (!isPrNumber(pr) || (repo !== undefined && !isRepoName(repo)))
        return reply.code(400).send({
          error: 'pr must be a positive integer and repo owner/name',
        } satisfies ErrorResponse);
      removeWatch(deps, {
        sessionId: request.params.id,
        pr,
        ...(repo === undefined ? {} : { repo }),
      });
      return reply.send({ ok: true } satisfies OkResponse);
    },
  );
}
