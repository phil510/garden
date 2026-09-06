import type { ErrorResponse, FileResponse, TreeResponse } from '@garden/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  NotADirectoryError,
  NotAFileError,
  PathNotFoundError,
  PathOutsideRootError,
  readSessionFile,
  readSessionTree,
} from '../../app/filesystem.js';
import type { FilesystemDeps } from '../../app/filesystem.js';
import { SessionNotFoundError } from '../../app/sessions.js';

interface FsQuerystring {
  readonly session?: string;
  readonly path?: string;
}

/** `PathOutsideRootError` and the kind mismatches are the client asking for the wrong
 *  thing; `PathNotFoundError` and `SessionNotFoundError` are the client asking for
 *  something that no longer exists. Anything else is an opaque filesystem error. */
function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SessionNotFoundError || error instanceof PathNotFoundError)
    return reply.code(404).send({ error: error.message } satisfies ErrorResponse);
  if (
    error instanceof PathOutsideRootError ||
    error instanceof NotAFileError ||
    error instanceof NotADirectoryError
  )
    return reply.code(400).send({ error: error.message } satisfies ErrorResponse);
  return reply.code(500).send({
    error: error instanceof Error ? error.message : String(error),
  } satisfies ErrorResponse);
}

export function fsRoutes(app: FastifyInstance, deps: FilesystemDeps) {
  app.get<{ Querystring: FsQuerystring }>('/fs/tree', async (request, reply) => {
    const { session, path = '' } = request.query;
    if (typeof session !== 'string')
      return reply
        .code(400)
        .send({ error: 'session query parameter is required' } satisfies ErrorResponse);
    try {
      const result: TreeResponse = await readSessionTree(deps, { sessionId: session, path });
      return reply.send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Querystring: FsQuerystring }>('/fs/file', async (request, reply) => {
    const { session, path } = request.query;
    if (typeof session !== 'string' || typeof path !== 'string')
      return reply
        .code(400)
        .send({ error: 'session and path query parameters are required' } satisfies ErrorResponse);
    try {
      const result: FileResponse = await readSessionFile(deps, { sessionId: session, path });
      return reply.send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
