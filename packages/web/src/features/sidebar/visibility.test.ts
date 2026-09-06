import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { hiddenOldDeadCount, visibleSessions } from './visibility';

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
