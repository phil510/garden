import type { CreateSessionRequest, CreateSessionResponse, SessionsResponse } from '@garden/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  createSession,
  killSession,
  resumeSession,
  SessionNotFoundError,
} from '../../app/sessions.js';
import type { SessionsDeps } from '../../app/sessions.js';

function isCreateSessionRequest(body: unknown): body is CreateSessionRequest {
  if (typeof body !== 'object' || body === null) return false;
  return typeof (body as Record<string, unknown>).cwd === 'string';
}

/** `SessionNotFoundError` is the one case a client can act on (the id is stale); every
 *  other failure is an opaque tmux or store error the client can only surface. */
function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SessionNotFoundError) return reply.code(404).send({ error: error.message });
  return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
}

export function sessionRoutes(app: FastifyInstance, deps: SessionsDeps) {
  app.get('/sessions', (): SessionsResponse => ({ sessions: deps.projection.sessions() }));

  app.post('/sessions', async (request, reply) => {
    if (!isCreateSessionRequest(request.body))
      return reply.code(400).send({ error: 'invalid create-session request' });
    try {
      const result: CreateSessionResponse = await createSession(deps, request.body);
      return reply.send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/resume', async (request, reply) => {
    try {
      const result: CreateSessionResponse = await resumeSession(deps, { id: request.params.id });
      return reply.send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/kill', async (request, reply) => {
    try {
      await killSession(deps, { id: request.params.id });
      return reply.send({ ok: true });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
