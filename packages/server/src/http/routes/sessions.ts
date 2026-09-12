import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ErrorResponse,
  OkResponse,
  SessionsFilter,
  SessionsResponse,
} from '@garden/shared';
import { isStatus } from '@garden/shared';
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

interface SessionsQuerystring {
  sinceDays?: string;
  maxRecapChars?: string;
  live?: string;
  status?: string;
}

type ParsedFilter = { ok: true; filter: SessionsFilter } | { ok: false; error: string };

/** Query params arrive as strings; this validates and translates them into a `SessionsFilter`,
 *  rejecting a non-numeric or negative `sinceDays`/`maxRecapChars` and an unmatchable `status`
 *  with a 400 rather than passing it through. The 7-day/500-char defaults belong to
 *  `sessionsFilter.ts`, not here — an omitted field is simply left off the returned filter. */
function parseSessionsFilter(query: SessionsQuerystring): ParsedFilter {
  const filter: SessionsFilter = {};

  if (query.sinceDays !== undefined) {
    const sinceDays = Number(query.sinceDays);
    if (!Number.isInteger(sinceDays) || sinceDays < 0)
      return { ok: false, error: 'sinceDays must be a non-negative integer' };
    filter.sinceDays = sinceDays;
  }

  if (query.maxRecapChars !== undefined) {
    const maxRecapChars = Number(query.maxRecapChars);
    if (!Number.isInteger(maxRecapChars) || maxRecapChars < 0)
      return { ok: false, error: 'maxRecapChars must be a non-negative integer' };
    filter.maxRecapChars = maxRecapChars;
  }

  if (query.live !== undefined) {
    if (query.live !== 'true' && query.live !== 'false')
      return { ok: false, error: 'live must be "true" or "false"' };
    filter.live = query.live === 'true';
  }

  if (query.status !== undefined) {
    if (!isStatus(query.status)) return { ok: false, error: `invalid status: ${query.status}` };
    filter.status = query.status;
  }

  return { ok: true, filter };
}

/** `SessionNotFoundError` is the one case a client can act on (the id is stale); every
 *  other failure is an opaque tmux or store error the client can only surface. */
function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SessionNotFoundError)
    return reply.code(404).send({ error: error.message } satisfies ErrorResponse);
  return reply.code(500).send({
    error: error instanceof Error ? error.message : String(error),
  } satisfies ErrorResponse);
}

export function sessionRoutes(app: FastifyInstance, deps: SessionsDeps) {
  app.get<{ Querystring: SessionsQuerystring }>('/sessions', (request, reply) => {
    const parsed = parseSessionsFilter(request.query);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error } satisfies ErrorResponse);
    return reply.send({
      sessions: deps.projection.sessions(parsed.filter),
    } satisfies SessionsResponse);
  });

  app.post('/sessions', async (request, reply) => {
    if (!isCreateSessionRequest(request.body))
      return reply
        .code(400)
        .send({ error: 'invalid create-session request' } satisfies ErrorResponse);
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
      return reply.send({ ok: true } satisfies OkResponse);
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
