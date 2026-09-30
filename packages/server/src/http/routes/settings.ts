import type { ErrorResponse, OkResponse, SettingsRequest, SettingsResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { getSettings, updateSettings } from '../../app/settings.js';
import type { SettingsDeps } from '../../app/settings.js';
import { isClaudeCommand } from '../../config.js';
export type { SettingsDeps } from '../../app/settings.js';

// isClaudeCommand rejects blank/whitespace-only strings too, so that case 400s here rather
// than reaching updateSettings's own check and surfacing as a 500.
function isSettingsRequest(body: unknown): body is SettingsRequest {
  if (typeof body !== 'object' || body === null) return false;
  return isClaudeCommand((body as Record<string, unknown>).claudeCommand);
}

export function settingsRoutes(app: FastifyInstance, deps: SettingsDeps) {
  app.get('/settings', (): SettingsResponse => getSettings(deps));

  app.put('/settings', (request, reply) => {
    if (!isSettingsRequest(request.body))
      return reply.code(400).send({ error: 'invalid settings request' } satisfies ErrorResponse);
    updateSettings(deps, request.body);
    return reply.send({ ok: true } satisfies OkResponse);
  });
}
