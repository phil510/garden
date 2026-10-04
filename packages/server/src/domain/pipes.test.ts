import { describe, expect, it } from 'vitest';
import { ackDigest, endUnpipedWatches, prunePipeTimes } from './pipes.js';
import type { Watch } from './watches.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;
const NONE: ReadonlySet<string> = new Set();

function aWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: 'w1',
    sessionId: 's1',
    repo: 'acme/widgets',
    pr: 7,
    kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
    createdAt: NOW,
    cursor: null,
    pendingDigest: null,
    status: 'active',
    ...overrides,
  };
}

const digest = (id: string) => ({ id, line: 'something happened', createdAt: NOW });

describe('ackDigest', () => {
  it('clears the digest whose id matches', () => {
    const watches = [aWatch({ pendingDigest: digest('d1') })];
    expect(ackDigest(watches, 's1', 'd1')).toEqual([aWatch({ pendingDigest: null })]);
  });

  it('returns the input array for a stale id, so a late ack leaves a newer digest pending', () => {
    const watches = [aWatch({ pendingDigest: digest('d2') })];
    expect(ackDigest(watches, 's1', 'd1')).toBe(watches);
  });

  it("returns the input array for another session's digest id", () => {
    const watches = [aWatch({ pendingDigest: digest('d1') })];
    expect(ackDigest(watches, 's2', 'd1')).toBe(watches);
  });

  it('clears only the matching watch among several', () => {
    const other = aWatch({ id: 'w2', pr: 8, pendingDigest: digest('d2') });
    const result = ackDigest([aWatch({ pendingDigest: digest('d1') }), other], 's1', 'd1');
    expect(result[1]).toBe(other);
    expect(result[0]?.pendingDigest).toBeNull();
  });
});

describe('endUnpipedWatches', () => {
  it('runs the clock from creation for a session that never connected', () => {
    const watch = aWatch({ createdAt: NOW - 7 * DAY - 1 });
    expect(endUnpipedWatches([watch], {}, NONE, NOW)).toEqual([]);
  });

  it('runs the clock from the last connection when it is later than creation', () => {
    const watch = aWatch({ createdAt: NOW - 30 * DAY });
    const recent = { s1: NOW - 2 * DAY };
    const stale = { s1: NOW - 7 * DAY - 1 };
    expect(endUnpipedWatches([watch], recent, NONE, NOW)).toEqual([watch]);
    expect(endUnpipedWatches([watch], stale, NONE, NOW)).toEqual([]);
  });

  it('runs the clock from creation when it is later than the last connection', () => {
    const watch = aWatch({ createdAt: NOW - 2 * DAY });
    expect(endUnpipedWatches([watch], { s1: NOW - 30 * DAY }, NONE, NOW)).toEqual([watch]);
  });

  it('leaves a connected session alone however old', () => {
    const watch = aWatch({ createdAt: NOW - 30 * DAY });
    const watches = [watch];
    expect(endUnpipedWatches(watches, {}, new Set(['s1']), NOW)).toBe(watches);
  });

  it('ends a watch only once it is strictly older than seven days', () => {
    const exactly = aWatch({ createdAt: NOW - 7 * DAY });
    const over = aWatch({ createdAt: NOW - 7 * DAY - 1 });
    expect(endUnpipedWatches([exactly], {}, NONE, NOW)).toEqual([exactly]);
    expect(endUnpipedWatches([over], {}, NONE, NOW)).toEqual([]);
  });

  it("leaves other sessions' watches untouched", () => {
    const old = aWatch({ createdAt: NOW - 30 * DAY });
    const other = aWatch({ id: 'w2', sessionId: 's2', createdAt: NOW - 30 * DAY });
    expect(endUnpipedWatches([old, other], {}, new Set(['s2']), NOW)).toEqual([other]);
  });

  it('returns the input array when nothing ends', () => {
    const watches = [aWatch()];
    expect(endUnpipedWatches(watches, {}, NONE, NOW)).toBe(watches);
  });
});

describe('prunePipeTimes', () => {
  it('drops entries older than seven days for unconnected sessions', () => {
    const times = { old: NOW - 7 * DAY - 1, edge: NOW - 7 * DAY, fresh: NOW - DAY };
    expect(prunePipeTimes(times, NONE, NOW)).toEqual({ edge: NOW - 7 * DAY, fresh: NOW - DAY });
  });

  it('keeps a stale entry for a connected session', () => {
    const times = { s1: NOW - 30 * DAY };
    expect(prunePipeTimes(times, new Set(['s1']), NOW)).toBe(times);
  });

  it('returns the input object when nothing changes', () => {
    const times = { s1: NOW };
    expect(prunePipeTimes(times, NONE, NOW)).toBe(times);
  });
});
