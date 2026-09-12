import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { filterSessions } from './sessionsFilter.js';

const now = 1_700_000_000_000;
const DAY_MS = 86_400_000;

describe('filterSessions', () => {
  it('drops a dead session with no activity inside the default 7-day window', () => {
    const stale = aSession({ id: 'stale', liveness: 'dead', lastActivity: now - 8 * DAY_MS });

    expect(filterSessions([stale], {}, now)).toEqual([]);
  });

  it('keeps a dead session that was recently active', () => {
    const recent = aSession({ id: 'recent', liveness: 'dead', lastActivity: now - 1 * DAY_MS });

    expect(filterSessions([recent], {}, now).map((s) => s.id)).toEqual(['recent']);
  });

  it('keeps a live session regardless of how stale lastActivity is', () => {
    const live = aSession({ id: 'live', liveness: 'live', lastActivity: now - 30 * DAY_MS });

    expect(filterSessions([live], {}, now).map((s) => s.id)).toEqual(['live']);
  });

  it('honors an explicit sinceDays window over the default', () => {
    const threeDaysOld = aSession({
      id: 's',
      liveness: 'dead',
      lastActivity: now - 3 * DAY_MS,
    });

    expect(filterSessions([threeDaysOld], { sinceDays: 1 }, now)).toEqual([]);
    expect(filterSessions([threeDaysOld], { sinceDays: 4 }, now).map((s) => s.id)).toEqual(['s']);
  });

  it('caps recap at the last N characters, keeping the tail rather than the head', () => {
    const recap = `${'stale filler '.repeat(40)}the interesting conclusion`;
    const session = aSession({ recap });

    const [filtered] = filterSessions([session], {}, now);

    expect(filtered?.recap).toBe(recap.slice(-500));
    expect(filtered?.recap).toContain('the interesting conclusion');
  });

  it('honors an explicit maxRecapChars over the default', () => {
    const session = aSession({ recap: 'a'.repeat(100) });

    const [filtered] = filterSessions([session], { maxRecapChars: 10 }, now);

    expect(filtered?.recap).toBe('a'.repeat(10));
  });

  it('leaves a recap under the cap untouched', () => {
    const session = aSession({ recap: 'short recap' });

    const [filtered] = filterSessions([session], {}, now);

    expect(filtered?.recap).toBe('short recap');
  });

  it('leaves a null recap untouched', () => {
    const session = aSession({ recap: null });

    const [filtered] = filterSessions([session], {}, now);

    expect(filtered?.recap).toBeNull();
  });

  it('applies the --live filter', () => {
    const live = aSession({ id: 'live', liveness: 'live' });
    const dead = aSession({ id: 'dead', liveness: 'dead', lastActivity: now });

    expect(filterSessions([live, dead], { live: true }, now).map((s) => s.id)).toEqual(['live']);
  });

  it('applies the --status filter', () => {
    const working = aSession({ id: 'working', status: 'working' });
    const waiting = aSession({ id: 'waiting', status: 'waiting' });

    expect(filterSessions([working, waiting], { status: 'working' }, now).map((s) => s.id)).toEqual(
      ['working'],
    );
  });
});
