import type { Alert } from '@garden/shared';
import { raiseAlert, withoutAlert } from '../domain/alerts.js';
import type { Projection } from './projection.js';
import { findSession } from './sessions.js';

export interface AlertsDeps {
  readonly projection: Projection;
}

/** Raising again replaces the session's alert in place, keeping its `raisedAt`. The overlay
 *  write lands first, so nothing is dispatched that was not persisted. */
export function raiseSessionAlert(deps: AlertsDeps, id: string, text: string, now: number): Alert {
  const { projection } = deps;
  const session = findSession(projection, id);
  const alert = raiseAlert(session.alert, text, now);
  projection.updateOverlay((base) => ({
    ...base,
    alerts: [...base.alerts.filter((a) => a.sessionId !== id), { ...alert, sessionId: id }],
  }));
  projection.dispatch({ type: 'alert-changed', sessionId: id, alert });
  return alert;
}

/** Idempotent: a session with no alert writes and dispatches nothing. */
export function clearSessionAlert(deps: AlertsDeps, id: string): void {
  const { projection } = deps;
  const session = findSession(projection, id);
  projection.updateOverlay((base) => withoutAlert(base, id));
  if (session.alert !== null)
    projection.dispatch({ type: 'alert-changed', sessionId: id, alert: null });
}

/** Boot: puts every persisted alert onto the projection. An alert for a session that no longer
 *  exists stays in state, waiting like any early-arriving fact. */
export function replayAlerts(deps: AlertsDeps): void {
  for (const { sessionId, ...alert } of deps.projection.overlay().alerts)
    deps.projection.dispatch({ type: 'alert-changed', sessionId, alert });
}
