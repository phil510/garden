import type { ErrorResponse } from '@garden/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  NotADirectoryError,
  NotAFileError,
  PathNotFoundError,
  PathOutsideRootError,
} from '../app/filesystem.js';
import { AmbiguousWatchError, RepoUnresolvedError, WatchNotFoundError } from '../app/errors.js';
import { ConfigWriteRefusedError } from '../app/ports.js';
import { RootNotListedError } from '../app/repoCatalog.js';
import { SessionNotFoundError } from '../app/sessions.js';
import { SwarmCycleError, SwarmNotFoundError } from '../app/swarms.js';

type ErrorClass = new (...args: never[]) => Error;

const STATUS_BY_ERROR: readonly (readonly [ErrorClass, number])[] = [
  [SessionNotFoundError, 404],
  [SwarmNotFoundError, 404],
  [PathNotFoundError, 404],
  [WatchNotFoundError, 404],
  [RepoUnresolvedError, 400],
  [AmbiguousWatchError, 400],
  [SwarmCycleError, 409],
  [ConfigWriteRefusedError, 409],
  [RootNotListedError, 403],
  [PathOutsideRootError, 400],
  [NotAFileError, 400],
  [NotADirectoryError, 400],
];

/** Fastify's own errors (malformed JSON, unsupported media type) carry a 4xx `statusCode`. */
function statusOf(error: unknown): number {
  const mapped = STATUS_BY_ERROR.find(([errorClass]) => error instanceof errorClass);
  if (mapped !== undefined) return mapped[1];
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) return statusCode;
  return 500;
}

/** Fastify's error handler for every route. A mapped or 4xx error is something the client
 *  can act on, so it logs at `warn`; anything else is an opaque failure, logged at `error`
 *  with its stack so root-causing doesn't need a reproduction. The body carries only the
 *  message. */
export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);
  if (status < 500) request.log.warn(message);
  else request.log.error(error instanceof Error ? (error.stack ?? message) : message);
  return reply.status(status).send({ error: message } satisfies ErrorResponse);
}
