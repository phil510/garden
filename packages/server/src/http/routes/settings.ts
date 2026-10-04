import type { ErrorResponse, OkResponse, SettingsRequest, SettingsResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { getSettings, settingsRequestProblem, updateSettings } from '../../app/settings.js';
import type { SettingsDeps } from '../../app/settings.js';
export type { SettingsDeps } from '../../app/settings.js';

export function settingsRoutes(app: FastifyInstance, deps: SettingsDeps) {
  app.get('/settings', (): SettingsResponse => getSettings(deps));

  app.put('/settings', (request, reply) => {
    const problem = settingsRequestProblem(request.body);
    if (problem !== null) return reply.code(400).send({ error: problem } satisfies ErrorResponse);
    updateSettings(deps, request.body as SettingsRequest);
    return reply.send({ ok: true } satisfies OkResponse);
  });
}
