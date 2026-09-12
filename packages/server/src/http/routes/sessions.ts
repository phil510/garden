import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ErrorResponse,
  OkResponse,
  SessionsFilter,
  SessionsResponse,
  Status,
} from '@garden/shared';
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

const DEFAULT_SINCE_DAYS = 7;
const DEFAULT_MAX_RECAP_CHARS = 500;
const STATUS_VALUES: readonly Status[] = ['working', 'needs-approval', 'waiting', 'unknown'];

function isStatus(value: string): value is Status {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

interface SessionsQuerystring {
  sinceDays?: string;
  maxRecapChars?: string;
  live?: string;
  status?: string;
}

type ParsedFilter = { ok: true; filter: SessionsFilter } | { ok: false; error: string };

/** Query params arrive as strings; this is where AC2/AC3's 7-day/500-char defaults are
 *  resolved and where an unparseable or out-of-range value becomes a 400 rather than
 *  silently passing a `NaN` or an unmatchable status through to the filter. */
function parseSessionsFilter(query: SessionsQuerystring): ParsedFilter {
  let sinceDays = DEFAULT_SINCE_DAYS;
  if (query.sinceDays !== undefined) {
    sinceDays = Number(query.sinceDays);
    if (!Number.isFinite(sinceDays)) return { ok: false, error: 'sinceDays must be a number' };
  }

  let maxRecapChars = DEFAULT_MAX_RECAP_CHARS;
  if (query.maxRecapChars !== undefined) {
    maxRecapChars = Number(query.maxRecapChars);
    if (!Number.isFinite(maxRecapChars))
      return { ok: false, error: 'maxRecapChars must be a number' };
  }

  const filter: SessionsFilter = { sinceDays, maxRecapChars };

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
