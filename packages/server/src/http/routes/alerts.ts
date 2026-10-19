import type { AlertResponse, ErrorResponse, OkResponse, RaiseAlertRequest } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { clearSessionAlert, raiseSessionAlert } from '../../app/alerts.js';
import type { AlertsDeps } from '../../app/alerts.js';

function isRaiseAlertRequest(body: unknown): body is RaiseAlertRequest {
  if (typeof body !== 'object' || body === null) return false;
  const { text } = body as Record<string, unknown>;
  return typeof text === 'string' && text.trim() !== '';
}

export function alertRoutes(app: FastifyInstance, deps: AlertsDeps) {
  app.post<{ Params: { id: string } }>('/sessions/:id/alert', (request, reply) => {
    if (!isRaiseAlertRequest(request.body))
      return reply
        .code(400)
        .send({ error: 'text must be a non-empty string' } satisfies ErrorResponse);
    const alert = raiseSessionAlert(deps, request.params.id, request.body.text, Date.now());
    return reply.send({ alert } satisfies AlertResponse);
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id/alert', (request, reply) => {
    clearSessionAlert(deps, request.params.id);
    return reply.send({ ok: true } satisfies OkResponse);
  });
}
