import type {
  CreateSwarmRequest,
  CreateSwarmResponse,
  ErrorResponse,
  OkResponse,
  Placement,
  PlacementRequest,
  RenameSwarmRequest,
} from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import {
  archiveSwarm,
  createSwarm,
  deleteSwarm,
  placeSession,
  renameSwarm,
  unarchiveSwarm,
} from '../../app/swarms.js';
import type { SwarmsDeps } from '../../app/swarms.js';

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

export function swarmRoutes(app: FastifyInstance, deps: SwarmsDeps) {
  app.post('/swarms', (request, reply) => {
    if (!isCreateSwarmRequest(request.body))
      return reply
        .code(400)
        .send({ error: 'invalid create-swarm request' } satisfies ErrorResponse);
    const result: CreateSwarmResponse = createSwarm(deps, request.body);
    return reply.code(201).send(result);
  });

  app.patch<{ Params: { id: string } }>('/swarms/:id', (request, reply) => {
    if (!isRenameSwarmRequest(request.body))
      return reply
        .code(400)
        .send({ error: 'invalid rename-swarm request' } satisfies ErrorResponse);
    renameSwarm(deps, { id: request.params.id, name: request.body.name });
    return reply.send({ ok: true } satisfies OkResponse);
  });

  app.post<{ Params: { id: string } }>('/swarms/:id/archive', (request, reply) => {
    archiveSwarm(deps, { id: request.params.id });
    return reply.send({ ok: true } satisfies OkResponse);
  });

  app.post<{ Params: { id: string } }>('/swarms/:id/unarchive', (request, reply) => {
    unarchiveSwarm(deps, { id: request.params.id });
    return reply.send({ ok: true } satisfies OkResponse);
  });

  app.delete<{ Params: { id: string } }>('/swarms/:id', (request, reply) => {
    deleteSwarm(deps, { id: request.params.id });
    return reply.send({ ok: true } satisfies OkResponse);
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/placement', (request, reply) => {
    if (!isPlacementRequest(request.body))
      return reply.code(400).send({ error: 'invalid placement request' } satisfies ErrorResponse);
    placeSession(deps, { sessionId: request.params.id, placement: request.body.placement });
    return reply.send({ ok: true } satisfies OkResponse);
  });
}
