import { STAGE_PRESETS } from '@garden/shared';
import type { ErrorResponse, OkResponse, StagePreset, UiStateRequest } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import type { Projection } from '../../app/projection.js';

export interface UiStateDeps {
  readonly projection: Projection;
}

const presets: ReadonlySet<StagePreset> = new Set(STAGE_PRESETS);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isSlotsArray(value: unknown): value is (string | null)[] {
  return (
    Array.isArray(value) && value.every((entry) => entry === null || typeof entry === 'string')
  );
}

function isUiStateRequest(body: unknown): body is UiStateRequest {
  if (typeof body !== 'object' || body === null) return false;
  const patch = body as Record<string, unknown>;
  if ('hideDead' in patch && typeof patch.hideDead !== 'boolean') return false;
  if ('groupOrder' in patch && !isStringArray(patch.groupOrder)) return false;
  if ('pinnedRepos' in patch && !isStringArray(patch.pinnedRepos)) return false;
  if ('collapsedRepos' in patch && !isStringArray(patch.collapsedRepos)) return false;
  if ('preset' in patch && !presets.has(patch.preset as StagePreset)) return false;
  if ('slots' in patch && !isSlotsArray(patch.slots)) return false;
  if ('focusedSlot' in patch && typeof patch.focusedSlot !== 'number') return false;
  return true;
}

export function uiStateRoutes(app: FastifyInstance, deps: UiStateDeps) {
  app.put('/ui-state', (request, reply) => {
    if (!isUiStateRequest(request.body))
      return reply.code(400).send({ error: 'invalid ui-state request' } satisfies ErrorResponse);
    try {
      deps.projection.updateUiState(request.body);
      return reply.send({ ok: true } satisfies OkResponse);
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : String(error),
      } satisfies ErrorResponse);
    }
  });
}
