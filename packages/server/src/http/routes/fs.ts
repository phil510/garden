import type { ErrorResponse, FileResponse, TreeResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { readFile, readTree } from '../../app/filesystem.js';
import type { FilesystemDeps, ScopeRequest } from '../../app/filesystem.js';

interface FsQuerystring {
  readonly session?: string;
  readonly root?: string;
  readonly path?: string;
  readonly refresh?: string;
}

/** Exactly one of `?session=` / `?root=`; anything else (neither, both, a repeated key) is
 *  not a scope. */
function scopeOf({ session, root }: FsQuerystring): ScopeRequest | undefined {
  if (typeof session === 'string' && root === undefined) return { sessionId: session };
  if (typeof root === 'string' && session === undefined) return { root };
  return undefined;
}

const SCOPE_REQUIRED: ErrorResponse = {
  error: 'exactly one of the session or root query parameters is required',
};

export function fsRoutes(app: FastifyInstance, deps: FilesystemDeps) {
  app.get<{ Querystring: FsQuerystring }>('/fs/tree', async (request, reply) => {
    const scope = scopeOf(request.query);
    if (scope === undefined) return reply.code(400).send(SCOPE_REQUIRED);
    const { path = '' } = request.query;
    if (typeof path !== 'string')
      return reply
        .code(400)
        .send({ error: 'path query parameter must be a single value' } satisfies ErrorResponse);
    const { refresh } = request.query;
    if (refresh !== undefined && typeof refresh !== 'string')
      return reply
        .code(400)
        .send({ error: 'refresh query parameter must be a single value' } satisfies ErrorResponse);
    const result: TreeResponse = await readTree(deps, {
      ...scope,
      path,
      ...(refresh === undefined ? {} : { refresh }),
    });
    return reply.send(result);
  });

  app.get<{ Querystring: FsQuerystring }>('/fs/file', async (request, reply) => {
    const scope = scopeOf(request.query);
    if (scope === undefined) return reply.code(400).send(SCOPE_REQUIRED);
    const { path } = request.query;
    if (typeof path !== 'string')
      return reply
        .code(400)
        .send({ error: 'path query parameter is required' } satisfies ErrorResponse);
    const result: FileResponse = await readFile(deps, { ...scope, path });
    return reply.send(result);
  });
}
