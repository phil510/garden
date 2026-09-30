import type { ErrorResponse, FileResponse, TreeResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { readSessionFile, readSessionTree } from '../../app/filesystem.js';
import type { FilesystemDeps } from '../../app/filesystem.js';

interface FsQuerystring {
  readonly session?: string;
  readonly path?: string;
}

export function fsRoutes(app: FastifyInstance, deps: FilesystemDeps) {
  app.get<{ Querystring: FsQuerystring }>('/fs/tree', async (request, reply) => {
    const { session, path = '' } = request.query;
    if (typeof session !== 'string')
      return reply
        .code(400)
        .send({ error: 'session query parameter is required' } satisfies ErrorResponse);
    const result: TreeResponse = await readSessionTree(deps, { sessionId: session, path });
    return reply.send(result);
  });

  app.get<{ Querystring: FsQuerystring }>('/fs/file', async (request, reply) => {
    const { session, path } = request.query;
    if (typeof session !== 'string' || typeof path !== 'string')
      return reply
        .code(400)
        .send({ error: 'session and path query parameters are required' } satisfies ErrorResponse);
    const result: FileResponse = await readSessionFile(deps, { sessionId: session, path });
    return reply.send(result);
  });
}
