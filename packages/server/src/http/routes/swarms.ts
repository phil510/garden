import type {
  CreateSwarmRequest,
  CreateSwarmResponse,
  ErrorResponse,
  OkResponse,
  Placement,
  PlacementRequest,
  RenameSwarmRequest,
} from '@garden/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  archiveSwarm,
  createSwarm,
  deleteSwarm,
  placeSession,
  renameSwarm,
  SwarmCycleError,
  SwarmNotFoundError,
  unarchiveSwarm,
} from '../../app/swarms.js';
import type { SwarmsDeps } from '../../app/swarms.js';
import { SessionNotFoundError } from '../../app/sessions.js';
import type { Logger } from '../../app/ports.js';

function isCreateSwarmRequest(body: unknown): body is CreateSwarmRequest {
  if (typeof body !== 'object' || body === null) return false;
  return typeof (body as Record<string, unknown>).name === 'string';
}

function isRenameSwarmRequest(body: unknown): body is RenameSwarmRequest {
  if (typeof body !== 'object' || body === null) return false;
  return typeof (body as Record<string, unknown>).name === 'string';
}

function isPlacement(value: unknown): value is Placement {
  if (typeof value !== 'object' || value === null) return false;
  const patch = value as Record<string, unknown>;
  if (patch.type === 'swarm') return typeof patch.swarmId === 'string';
  if (patch.type === 'parent') return typeof patch.parentId === 'string';
  return patch.type === 'none';
}

function isPlacementRequest(body: unknown): body is PlacementRequest {
  if (typeof body !== 'object' || body === null) return false;
  return isPlacement((body as Record<string, unknown>).placement);
}

/** Mirrors `http/routes/sessions.ts`'s `sendError`: the one case a client can act on is
 *  logged at `warn`, everything else at `error` with its stack. */
function sendError(logger: Logger, reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SwarmNotFoundError || error instanceof SessionNotFoundError) {
    logger.warn(error.message);
    return reply.code(404).send({ error: error.message } satisfies ErrorResponse);
  }
  if (error instanceof SwarmCycleError) {
    logger.warn(error.message);
    return reply.code(409).send({ error: error.message } satisfies ErrorResponse);
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error(error instanceof Error ? (error.stack ?? message) : message);
  return reply.code(500).send({ error: message } satisfies ErrorResponse);
}

export function swarmRoutes(app: FastifyInstance, deps: SwarmsDeps, logger: Logger) {
  app.post('/swarms', (request, reply) => {
    if (!isCreateSwarmRequest(request.body))
      return reply
        .code(400)
        .send({ error: 'invalid create-swarm request' } satisfies ErrorResponse);
    try {
      const result: CreateSwarmResponse = createSwarm(deps, request.body);
      return reply.code(201).send(result);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>('/swarms/:id', (request, reply) => {
    if (!isRenameSwarmRequest(request.body))
      return reply
        .code(400)
        .send({ error: 'invalid rename-swarm request' } satisfies ErrorResponse);
    try {
      renameSwarm(deps, { id: request.params.id, name: request.body.name });
      return reply.send({ ok: true } satisfies OkResponse);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/swarms/:id/archive', (request, reply) => {
    try {
      archiveSwarm(deps, { id: request.params.id });
      return reply.send({ ok: true } satisfies OkResponse);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/swarms/:id/unarchive', (request, reply) => {
    try {
      unarchiveSwarm(deps, { id: request.params.id });
      return reply.send({ ok: true } satisfies OkResponse);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/swarms/:id', (request, reply) => {
    try {
      deleteSwarm(deps, { id: request.params.id });
      return reply.send({ ok: true } satisfies OkResponse);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/placement', (request, reply) => {
    if (!isPlacementRequest(request.body))
      return reply.code(400).send({ error: 'invalid placement request' } satisfies ErrorResponse);
    try {
      placeSession(deps, { sessionId: request.params.id, placement: request.body.placement });
      return reply.send({ ok: true } satisfies OkResponse);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });
}
