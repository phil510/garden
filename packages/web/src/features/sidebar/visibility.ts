import type { SessionState } from '@garden/shared';

const OLD_DEAD_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;
const DEAD_SESSION_CAP = 10;

export interface VisibilityState {
  hideDead: boolean;
  showOlder: boolean;
}

function isOldDead(session: SessionState, now: number): boolean {
  return session.liveness === 'dead' && now - session.lastActivity > OLD_DEAD_THRESHOLD_MS;
}

/**
 * A dead session is visible by default only within the 14-day window; `hideDead` hides every
 * dead session regardless of age, and `showOlder` reveals the older ones the window would
 * otherwise hold back. Live sessions are always visible.
 */
export function visibleSessions(
  sessions: readonly SessionState[],
  { hideDead, showOlder }: VisibilityState,
  now: number,
): SessionState[] {
  return sessions.filter((session) => {
    if (session.liveness !== 'dead') return true;
    if (hideDead) return false;
    if (isOldDead(session, now) && !showOlder) return false;
    return true;
  });
}

export function hiddenOldDeadCount(
  sessions: readonly SessionState[],
  hideDead: boolean,
  now: number,
): number {
  if (hideDead) return 0;
  return sessions.filter((session) => isOldDead(session, now)).length;
}

/**
 * Caps dead sessions at `DEAD_SESSION_CAP`, keeping their existing order, unless `expanded`
 * reveals the rest. Live sessions are never counted against the cap or dropped.
 */
export function capDeadSessions(
  sessions: readonly SessionState[],
  expanded: boolean,
): SessionState[] {
  if (expanded) return [...sessions];
  let deadKept = 0;
  return sessions.filter((session) => {
    if (session.liveness !== 'dead') return true;
    deadKept += 1;
    return deadKept <= DEAD_SESSION_CAP;
  });
}

export function hiddenCappedDeadCount(sessions: readonly SessionState[]): number {
  const deadCount = sessions.filter((session) => session.liveness === 'dead').length;
  return Math.max(0, deadCount - DEAD_SESSION_CAP);
}
