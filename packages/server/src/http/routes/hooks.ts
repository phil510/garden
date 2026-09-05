import type { HookPayload } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { handleHook, type HooksDeps } from '../../app/hooks.js';

function isHookPayload(body: unknown): body is HookPayload {
  if (typeof body !== 'object' || body === null) return false;
  const { session_id, cwd, transcript_path, hook_event_name } = body as Record<string, unknown>;
  return (
    typeof session_id === 'string' &&
    typeof cwd === 'string' &&
    typeof transcript_path === 'string' &&
    typeof hook_event_name === 'string'
  );
}

export function hookRoutes(app: FastifyInstance, deps: HooksDeps) {
  app.post('/hooks', (request, reply) => {
    if (!isHookPayload(request.body))
      return reply.code(400).send({ error: 'invalid hook payload' });
    handleHook(deps, request.body);
    return reply.code(204).send();
  });
}
