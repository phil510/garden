import type { Alert, SessionState } from '@garden/shared';
import { formatRelativeTime } from '../sidebar/relativeTime';

/** Sessions with an open alert, oldest `raisedAt` first so a replaced alert keeps its place.
 *  Dead sessions are included: a session that died on its own keeps its alert. */
export function collectAlerts(sessions: readonly SessionState[]): SessionState[] {
  return sessions
    .filter((session) => session.alert !== null)
    .sort(
      (a, b) =>
        (a.alert?.raisedAt ?? 0) - (b.alert?.raisedAt ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** `raised 3h ago`, plus ` · updated 1h ago` once the replaced text reads as a different age. */
export function alertAgesLine(alert: Alert, now: number): string {
  const raised = formatRelativeTime(alert.raisedAt, now);
  const updated = formatRelativeTime(alert.updatedAt, now);
  return updated === raised ? `raised ${raised}` : `raised ${raised} · updated ${updated}`;
}
