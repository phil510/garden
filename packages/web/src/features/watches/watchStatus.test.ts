import type { WatchSummary } from '@garden/shared';
import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import {
  PIPE_FAULT,
  faultSummary,
  kindsLabel,
  rowWatchState,
  watchLineState,
  watchPrUrl,
} from './watchStatus';

const aWatch = (overrides: Partial<WatchSummary> = {}): WatchSummary => ({
  repo: 'acme/api',
  pr: 1,
  kinds: ['review', 'closed'],
  pendingDigest: false,
  ignoredChecks: [],
  status: 'active',
  ...overrides,
});

describe('rowWatchState', () => {
  it('is null for a session with no watches', () => {
    expect(rowWatchState(aSession(), false)).toBeNull();
  });

  it('is watching for an active watch with a connected pipe', () => {
    const session = aSession({ watches: [aWatch()] });
    expect(rowWatchState(session, false)).toEqual({ tone: 'watching', count: 1 });
  });

  it('faults a dead session whose watch is in error', () => {
    const session = aSession({
      liveness: 'dead',
      watches: [aWatch({ status: 'error', errorReason: 'gh is not logged in.' })],
    });
    expect(rowWatchState(session, false)?.tone).toBe('fault');
  });

  it('faults a live session whose pipe is faulted even when every watch is active', () => {
    const session = aSession({ watches: [aWatch()] });
    expect(rowWatchState(session, true)?.tone).toBe('fault');
  });

  it('counts every watch', () => {
    const session = aSession({ watches: [aWatch({ pr: 1 }), aWatch({ pr: 2 })] });
    expect(rowWatchState(session, false)?.count).toBe(2);
  });

  it('stays watching when a digest is pending', () => {
    const session = aSession({ watches: [aWatch({ pendingDigest: true })] });
    expect(rowWatchState(session, false)?.tone).toBe('watching');
  });
});

describe('watchLineState', () => {
  it('labels an error watch as an error', () => {
    expect(watchLineState(aWatch({ status: 'error', errorReason: 'x' }))).toEqual({
      tone: 'error',
      label: 'error',
    });
  });

  it('labels a closed watch with a pending digest', () => {
    expect(watchLineState(aWatch({ status: 'closed', pendingDigest: true }))).toEqual({
      tone: 'pending',
      label: 'closed · digest pending',
    });
  });

  it('labels a closed watch', () => {
    expect(watchLineState(aWatch({ status: 'closed' }))).toEqual({
      tone: 'closed',
      label: 'closed',
    });
  });

  it('labels an active watch with a pending digest', () => {
    expect(watchLineState(aWatch({ pendingDigest: true }))).toEqual({
      tone: 'pending',
      label: 'digest pending',
    });
  });

  it('labels a quiet active watch as watching', () => {
    expect(watchLineState(aWatch())).toEqual({ tone: 'watching', label: 'watching' });
  });
});

describe('kindsLabel', () => {
  it('joins kinds and marks plain checks as failures only', () => {
    expect(kindsLabel(['review', 'comment', 'checks', 'conflict', 'closed'])).toBe(
      'review · comment · checks (failures) · conflict · closed',
    );
  });

  it('renders checks:all as checks (all) without a separate checks entry', () => {
    expect(kindsLabel(['review', 'checks', 'checks:all', 'closed'])).toBe(
      'review · checks (all) · closed',
    );
  });
});

describe('faultSummary', () => {
  it('names the pipe fault and each distinct error reason once', () => {
    const session = aSession({
      watches: [
        aWatch({ pr: 1, status: 'error', errorReason: 'PR not found.' }),
        aWatch({ pr: 2, status: 'error', errorReason: 'PR not found.' }),
        aWatch({ pr: 3 }),
      ],
    });
    expect(faultSummary(session, true)).toBe(`${PIPE_FAULT.label}; PR not found.`);
  });

  it('omits the pipe label when the pipe is fine', () => {
    const session = aSession({
      watches: [aWatch({ status: 'error', errorReason: 'gh is not logged in.' })],
    });
    expect(faultSummary(session, false)).toBe('gh is not logged in.');
  });
});

describe('watchPrUrl', () => {
  it('points at the pull request page of the watch repo', () => {
    expect(watchPrUrl(aWatch({ repo: 'acme/api', pr: 42 }))).toBe(
      'https://github.com/acme/api/pull/42',
    );
  });
});
