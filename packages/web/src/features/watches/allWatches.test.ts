import type { WatchSummary as Watch } from '@garden/shared';
import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { anyFault, collectWatchGroups, summarizeWatchGroups } from './allWatches';

const watch = (overrides: Partial<Watch> = {}): Watch => ({
  repo: 'acme/api',
  pr: 1,
  kinds: ['review', 'closed'],
  pendingDigest: false,
  ignoredChecks: [],
  status: 'active',
  ...overrides,
});

const none = new Set<string>();
const ids = (groups: { session: { id: string } }[]) => groups.map((group) => group.session.id);

describe('collectWatchGroups', () => {
  it('leaves out sessions without watches', () => {
    const sessions = [aSession({ id: 'a' }), aSession({ id: 'b', watches: [watch()] })];
    expect(ids(collectWatchGroups(sessions, none))).toEqual(['b']);
  });

  it('ranks faults, then pending digests, then the rest', () => {
    const sessions = [
      aSession({ id: 'quiet', watches: [watch()], lastActivity: 300 }),
      aSession({ id: 'pending', watches: [watch({ pendingDigest: true })], lastActivity: 200 }),
      aSession({ id: 'error', watches: [watch({ status: 'error' })], lastActivity: 100 }),
    ];
    expect(ids(collectWatchGroups(sessions, none))).toEqual(['error', 'pending', 'quiet']);
  });

  it('ranks a pipe-faulted session as a fault', () => {
    const sessions = [
      aSession({ id: 'quiet', watches: [watch()], lastActivity: 300 }),
      aSession({ id: 'piped', watches: [watch()], lastActivity: 100 }),
    ];
    expect(ids(collectWatchGroups(sessions, new Set(['piped'])))).toEqual(['piped', 'quiet']);
  });

  it('orders by most recent activity within a rank', () => {
    const sessions = [
      aSession({ id: 'old', watches: [watch()], lastActivity: 100 }),
      aSession({ id: 'new', watches: [watch()], lastActivity: 200 }),
    ];
    expect(ids(collectWatchGroups(sessions, none))).toEqual(['new', 'old']);
  });

  it('keeps input order for equal rank and activity', () => {
    const sessions = [
      aSession({ id: 'first', watches: [watch()] }),
      aSession({ id: 'second', watches: [watch()] }),
    ];
    expect(ids(collectWatchGroups(sessions, none))).toEqual(['first', 'second']);
  });
});

describe('summarizeWatchGroups', () => {
  it('counts watches, sessions, faulted sessions and pending digests', () => {
    const groups = collectWatchGroups(
      [
        aSession({ id: 'a', watches: [watch({ pr: 1 }), watch({ pr: 2, pendingDigest: true })] }),
        aSession({ id: 'b', watches: [watch({ status: 'error' })] }),
      ],
      none,
    );
    expect(summarizeWatchGroups(groups)).toEqual({
      watches: 3,
      sessions: 2,
      faultedSessions: 1,
      pendingDigests: 1,
    });
  });
});

describe('anyFault', () => {
  it('is false for pending digests alone', () => {
    const groups = collectWatchGroups(
      [aSession({ watches: [watch({ pendingDigest: true })] })],
      none,
    );
    expect(anyFault(groups)).toBe(false);
  });

  it('is true for a dead session with an error watch', () => {
    const groups = collectWatchGroups(
      [aSession({ liveness: 'dead', status: null, watches: [watch({ status: 'error' })] })],
      none,
    );
    expect(anyFault(groups)).toBe(true);
  });

  it('is true for a pipe-faulted live session', () => {
    const session = aSession({ id: 'live', watches: [watch()] });
    expect(anyFault(collectWatchGroups([session], new Set(['live'])))).toBe(true);
  });
});
