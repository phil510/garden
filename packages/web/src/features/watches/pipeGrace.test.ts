import { aSession } from '@garden/shared/fixtures';
import type { WatchSummary } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { isPipeFaulted, nextGraceExpiry, pipeFaultedIds, trackPipeDown } from './pipeGrace';
import { PIPE_GRACE_MS } from './watchStatus';

const watch: WatchSummary = {
  repo: 'acme/api',
  pr: 1,
  kinds: ['closed'],
  pendingDigest: false,
  ignoredChecks: [],
  status: 'active',
};
const disconnected = (id: string, overrides = {}) =>
  aSession({ id, pipeConnected: false, watches: [watch], ...overrides });

describe('trackPipeDown', () => {
  it('records the first time a live watching session is seen disconnected', () => {
    expect(trackPipeDown({}, [disconnected('a')], 100)).toEqual({ a: 100 });
  });

  it('keeps the first-seen time across recomputes', () => {
    const first = trackPipeDown({}, [disconnected('a')], 100);
    expect(trackPipeDown(first, [disconnected('a')], 900)).toEqual({ a: 100 });
  });

  it('drops a session that reconnects', () => {
    const connected = disconnected('a', { pipeConnected: true });
    expect(trackPipeDown({ a: 100 }, [connected], 200)).toEqual({});
  });

  it('never tracks a dead session', () => {
    expect(trackPipeDown({}, [disconnected('a', { liveness: 'dead' })], 100)).toEqual({});
  });

  it('never tracks a session with no watches', () => {
    expect(trackPipeDown({}, [disconnected('a', { watches: [] })], 100)).toEqual({});
  });

  it('drops a session that is no longer present', () => {
    expect(trackPipeDown({ gone: 100 }, [], 200)).toEqual({});
  });
});

describe('isPipeFaulted', () => {
  it('is not faulted before the grace period elapses', () => {
    expect(isPipeFaulted('a', { a: 100 }, 100 + PIPE_GRACE_MS - 1)).toBe(false);
  });

  it('is faulted once the grace period has elapsed', () => {
    expect(isPipeFaulted('a', { a: 100 }, 100 + PIPE_GRACE_MS)).toBe(true);
  });

  it('is not faulted when the session is not tracked', () => {
    expect(isPipeFaulted('a', {}, 1_000_000)).toBe(false);
  });
});

describe('pipeFaultedIds', () => {
  it('lists only the sessions past their grace period', () => {
    const downSince = { old: 0, fresh: PIPE_GRACE_MS };
    expect(pipeFaultedIds(downSince, PIPE_GRACE_MS + 1)).toEqual(new Set(['old']));
  });
});

describe('nextGraceExpiry', () => {
  it('is the soonest expiry still in the future', () => {
    const downSince = { faulted: 0, soon: 1000, later: 3000 };
    expect(nextGraceExpiry(downSince, PIPE_GRACE_MS + 1)).toBe(1000 + PIPE_GRACE_MS);
  });

  it('is null when nothing is waiting to expire', () => {
    expect(nextGraceExpiry({ a: 0 }, PIPE_GRACE_MS)).toBeNull();
    expect(nextGraceExpiry({}, 0)).toBeNull();
  });
});
