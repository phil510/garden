import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import {
  capDeadSessions,
  hiddenCappedDeadCount,
  hiddenOldDeadCount,
  visibleSessions,
} from './visibility';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 20 * DAY_MS;

describe('visibleSessions', () => {
  it('always shows live sessions regardless of age', () => {
    const session = aSession({ liveness: 'live', lastActivity: 0 });
    expect(visibleSessions([session], { hideDead: false, showOlder: false }, NOW)).toEqual([
      session,
    ]);
  });

  it('shows a dead session active within the last 14 days', () => {
    const session = aSession({ liveness: 'dead', lastActivity: NOW - 5 * DAY_MS });
    expect(visibleSessions([session], { hideDead: false, showOlder: false }, NOW)).toEqual([
      session,
    ]);
  });

  it('hides a dead session last active more than 14 days ago', () => {
    const session = aSession({ liveness: 'dead', lastActivity: NOW - 15 * DAY_MS });
    expect(visibleSessions([session], { hideDead: false, showOlder: false }, NOW)).toEqual([]);
  });

  it('hides a session reporting lastActivity 0 — outside the 14-day window by design, not an accident', () => {
    const session = aSession({ liveness: 'dead', lastActivity: 0 });
    expect(visibleSessions([session], { hideDead: false, showOlder: false }, NOW)).toEqual([]);
  });

  it('hides every dead session when hideDead is set, regardless of age', () => {
    const recent = aSession({ id: 'recent', liveness: 'dead', lastActivity: NOW - DAY_MS });
    const old = aSession({ id: 'old', liveness: 'dead', lastActivity: NOW - 20 * DAY_MS });
    expect(visibleSessions([recent, old], { hideDead: true, showOlder: false }, NOW)).toEqual([]);
  });

  it('reveals an old dead session when showOlder is set', () => {
    const session = aSession({ liveness: 'dead', lastActivity: NOW - 20 * DAY_MS });
    expect(visibleSessions([session], { hideDead: false, showOlder: true }, NOW)).toEqual([
      session,
    ]);
  });
});

describe('hiddenOldDeadCount', () => {
  it('counts dead sessions older than 14 days', () => {
    const recent = aSession({ id: 'recent', liveness: 'dead', lastActivity: NOW - DAY_MS });
    const old = aSession({ id: 'old', liveness: 'dead', lastActivity: NOW - 20 * DAY_MS });
    expect(hiddenOldDeadCount([recent, old], false, NOW)).toBe(1);
  });

  it('is zero once hideDead already hides every dead session', () => {
    const old = aSession({ liveness: 'dead', lastActivity: NOW - 20 * DAY_MS });
    expect(hiddenOldDeadCount([old], true, NOW)).toBe(0);
  });
});

describe('capDeadSessions', () => {
  it('keeps every dead session when there are fewer than the cap', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, false, 10)).toEqual(sessions);
  });

  it('keeps only the first 10 dead sessions, in their original order, when collapsed', () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, false, 10)).toEqual(sessions.slice(0, 10));
  });

  it('keeps every dead session when expanded', () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, true, 10)).toEqual(sessions);
  });

  it('never drops a live session, even past the dead-session cap boundary', () => {
    const deadSessions = Array.from({ length: 12 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    const live = aSession({ id: 'live', liveness: 'live' });
    const sessions = [...deadSessions, live];
    const capped = capDeadSessions(sessions, false, 10);
    expect(capped).toContainEqual(live);
    expect(capped).toHaveLength(11);
  });

  it('keeps exactly 10 dead sessions when the cap is not exceeded', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, false, 10)).toEqual(sessions);
  });

  it('drops exactly the 11th dead session when one over the cap', () => {
    const sessions = Array.from({ length: 11 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, false, 10)).toEqual(sessions.slice(0, 10));
  });
});

describe('capDeadSessions with a configured cap', () => {
  it('keeps only that many dead sessions when collapsed', () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(capDeadSessions(sessions, false, 3)).toEqual(sessions.slice(0, 3));
  });
});

describe('hiddenCappedDeadCount', () => {
  it('returns the count of dead sessions past the cap', () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(hiddenCappedDeadCount(sessions, 10)).toBe(5);
  });

  it('is zero when dead sessions are at or under the cap', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(hiddenCappedDeadCount(sessions, 10)).toBe(0);
  });

  it('ignores live sessions when counting the remainder', () => {
    const deadSessions = Array.from({ length: 12 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    const live = aSession({ id: 'live', liveness: 'live' });
    expect(hiddenCappedDeadCount([...deadSessions, live], 10)).toBe(2);
  });
});

describe('hiddenCappedDeadCount with a configured cap', () => {
  it('counts dead sessions past that cap', () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      aSession({ id: `dead-${i}`, liveness: 'dead' }),
    );
    expect(hiddenCappedDeadCount(sessions, 3)).toBe(5);
  });
});
