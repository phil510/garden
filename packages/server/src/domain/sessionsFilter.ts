import type { SessionsFilter, SessionState } from '@garden/shared';

const DEFAULT_SINCE_DAYS = 7;
const DEFAULT_MAX_RECAP_CHARS = 500;

/** A pure, read-time view over an already-materialized session list — never mutates
 *  `state.sessions`, so widening `sinceDays`/`maxRecapChars` on a later call can always
 *  recover what a narrower one hid. `now` comes in as an argument rather than reading the
 *  clock, per docs/architecture.md §4.1. */
export function filterSessions(
  sessions: SessionState[],
  filter: SessionsFilter,
  now: number,
): SessionState[] {
  const sinceMs = (filter.sinceDays ?? DEFAULT_SINCE_DAYS) * 86_400_000;
  const maxRecapChars = filter.maxRecapChars ?? DEFAULT_MAX_RECAP_CHARS;

  return sessions
    .filter((session) => session.liveness === 'live' || now - session.lastActivity <= sinceMs)
    .filter((session) => filter.live !== true || session.liveness === 'live')
    .filter((session) => filter.status === undefined || session.status === filter.status)
    .map((session) =>
      session.recap === null ? session : { ...session, recap: session.recap.slice(-maxRecapChars) },
    );
}
