import type { SettingsResponse } from '@garden/shared';
import type { FastifyInstance } from 'fastify';

export interface SettingsDeps {
  readonly deadSessionCap: number;
  readonly terminalFontSize: number;
}

/** Read-only: the client-side settings from `config.json`, served straight from the
 *  composition root with no `app/` use case behind it — there is no logic here to place. */
export function settingsRoutes(app: FastifyInstance, deps: SettingsDeps) {
  app.get('/settings', (): SettingsResponse => ({
    deadSessionCap: deps.deadSessionCap,
    terminalFontSize: deps.terminalFontSize,
  }));
}
