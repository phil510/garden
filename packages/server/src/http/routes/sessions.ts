import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ErrorResponse,
  OkResponse,
  SessionsFilter,
  SessionsResponse,
} from '@garden/shared';
import { isStatus, parseNonNegativeInt } from '@garden/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  createSession,
  killSession,
  resumeSession,
  SessionNotFoundError,
} from '../../app/sessions.js';
import type { SessionsDeps } from '../../app/sessions.js';
import type { Logger } from '../../app/ports.js';
import { CrossSwarmHandoffError, SwarmCycleError } from '../../app/swarms.js';

function isCreateSessionRequest(body: unknown): body is CreateSessionRequest {
  if (typeof body !== 'object' || body === null) return false;
  const record = body as Record<string, unknown>;
  if (typeof record.cwd !== 'string') return false;
  if (record.callerSessionId !== undefined && typeof record.callerSessionId !== 'string')
    return false;
  return record.handoff === undefined || typeof record.handoff === 'boolean';
}

interface SessionsQuerystring {
  sinceDays?: string | string[];
  maxRecapChars?: string | string[];
  live?: string | string[];
  status?: string | string[];
  swarm?: string | string[];
}

type ParsedFilter = { ok: true; filter: SessionsFilter } | { ok: false; error: string };

type NarrowedField = { ok: true; value: string | undefined } | { ok: false; error: string };

/** Fastify's querystring parser turns a repeated key into an array, even though a
 *  well-formed request only ever supplies one value per field — this is the one place
 *  that distinction is enforced, before any field-specific parsing runs. A length-1 array
 *  can't occur with the pinned `fast-querystring` parser (a repeated key is always
 *  length >= 2), so every array is rejected unconditionally rather than special-cased. */
function narrowQueryField(field: string, raw: string | string[] | undefined): NarrowedField {
  if (Array.isArray(raw)) return { ok: false, error: `${field} must not be repeated` };
  return { ok: true, value: raw };
}

/** Validates and translates the querystring into a `SessionsFilter`, rejecting a repeated
 *  key (see `narrowQueryField`), a non-numeric or negative `sinceDays`/`maxRecapChars`, and
 *  an unmatchable `status` with a 400 rather than passing it through. The 7-day/500-char
 *  defaults belong to `sessionsFilter.ts`, not here — an omitted field is simply left off
 *  the returned filter. */
function parseSessionsFilter(query: SessionsQuerystring): ParsedFilter {
  const filter: SessionsFilter = {};

  const sinceDaysField = narrowQueryField('sinceDays', query.sinceDays);
  if (!sinceDaysField.ok) return sinceDaysField;
  if (sinceDaysField.value !== undefined) {
    const sinceDays = parseNonNegativeInt(sinceDaysField.value);
    if (sinceDays === undefined)
      return { ok: false, error: 'sinceDays must be a non-negative integer' };
    filter.sinceDays = sinceDays;
  }

  const maxRecapCharsField = narrowQueryField('maxRecapChars', query.maxRecapChars);
  if (!maxRecapCharsField.ok) return maxRecapCharsField;
  if (maxRecapCharsField.value !== undefined) {
    const maxRecapChars = parseNonNegativeInt(maxRecapCharsField.value);
    if (maxRecapChars === undefined)
      return { ok: false, error: 'maxRecapChars must be a non-negative integer' };
    filter.maxRecapChars = maxRecapChars;
  }

  const liveField = narrowQueryField('live', query.live);
  if (!liveField.ok) return liveField;
  if (liveField.value !== undefined) {
    if (liveField.value !== 'true' && liveField.value !== 'false')
      return { ok: false, error: 'live must be "true" or "false"' };
    filter.live = liveField.value === 'true';
  }

  const statusField = narrowQueryField('status', query.status);
  if (!statusField.ok) return statusField;
  if (statusField.value !== undefined) {
    if (!isStatus(statusField.value))
      return { ok: false, error: `invalid status: ${statusField.value}` };
    filter.status = statusField.value;
  }

  const swarmField = narrowQueryField('swarm', query.swarm);
  if (!swarmField.ok) return swarmField;
  if (swarmField.value !== undefined) filter.swarmId = swarmField.value;

  return { ok: true, filter };
}

/** `SessionNotFoundError` is the one case a client can act on (the id is stale) — logged at
 *  `warn`, since a stale id is an expected condition, not the failure this route guards
 *  against. `SwarmCycleError`/`CrossSwarmHandoffError` are the `new --handoff` rejections
 *  `computeHandoff` produces, mirrored here from `http/routes/swarms.ts`'s own `sendError`
 *  (kept separately maintained per file, not a shared helper). Every other failure is an
 *  opaque tmux or store error, logged at `error` with its stack (when it has one) rather
 *  than only its message, so root-causing from logs doesn't need to reproduce the failure
 *  to find where it came from; the response body still carries only the message. */
function sendError(logger: Logger, reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SessionNotFoundError) {
    logger.warn(error.message);
    return reply.code(404).send({ error: error.message } satisfies ErrorResponse);
  }
  if (error instanceof SwarmCycleError || error instanceof CrossSwarmHandoffError) {
    logger.warn(error.message);
    return reply.code(409).send({ error: error.message } satisfies ErrorResponse);
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error(error instanceof Error ? (error.stack ?? message) : message);
  return reply.code(500).send({ error: message } satisfies ErrorResponse);
}

export function sessionRoutes(app: FastifyInstance, deps: SessionsDeps, logger: Logger) {
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
      const result = await createSession(deps, request.body);
      if (result.unknownCaller === true)
        logger.warn(`unknown caller session, spawned without placement: ${result.id}`);
      return reply.send({
        id: result.id,
        tmuxName: result.tmuxName,
      } satisfies CreateSessionResponse);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/resume', async (request, reply) => {
    try {
      const result: CreateSessionResponse = await resumeSession(deps, { id: request.params.id });
      return reply.send(result);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/sessions/:id/kill', async (request, reply) => {
    try {
      await killSession(deps, { id: request.params.id });
      return reply.send({ ok: true } satisfies OkResponse);
    } catch (error) {
      return sendError(logger, reply, error);
    }
  });
}
