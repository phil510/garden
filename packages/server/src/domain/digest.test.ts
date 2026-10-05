import { describe, expect, it } from 'vitest';
import { applyObservation, formatDigestLine, markWatchError } from './digest.js';
import type { DigestSettings } from './digest.js';
import { emptyTally, emptyTracking, readCursor } from './pollCursor.js';
import type { Activity, Observation } from './pollCursor.js';
import type { Watch } from './watches.js';

const MIN = 60_000;
const T0 = 10_000_000;
const settings: DigestSettings = { ignoreAuthors: [], quietWindowMs: 3 * MIN };

const watch = (overrides: Partial<Watch> = {}): Watch => ({
  id: 'w1',
  sessionId: 's1',
  repo: 'acme/widgets',
  pr: 7,
  kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
  createdAt: T0 - 1000 * MIN,
  cursor: null,
  pendingDigest: null,
  status: 'active',
  ...overrides,
});

const none: Activity = {
  reviews: [],
  issueComments: [],
  reviewComments: [],
  checks: [],
  conflict: null,
  closed: null,
};
const observe = (activity: Partial<Activity> = {}): Observation => ({
  activity: { ...none, ...activity },
  tracking: emptyTracking(),
});
let itemId = 0;
const comment = (login: string, at: number) => ({ id: ++itemId, login, at });
const review = (login: string, at: number) => ({ id: ++itemId, login, state: 'APPROVED', at });
const checkRun = (name: string, outcome: 'failed' | 'passed', at: number) => ({
  kind: 'check-run' as const,
  id: ++itemId,
  name,
  conclusion: outcome === 'failed' ? 'failure' : 'success',
  outcome,
  at,
  headSha: 'sha1',
});

let counter = 0;
const mint = () => `d${String(++counter)}`;

function apply(w: Watch, activity: Partial<Activity>, now: number, s = settings): Watch {
  return applyObservation(w, observe(activity), s, now, mint);
}

describe('kinds and filters', () => {
  it('ignores comments for a watch without the comment kind', () => {
    const w = watch({ kinds: ['review', 'closed'] });

    const next = apply(w, { issueComments: [comment('a', T0 - 10 * MIN)] }, T0);

    expect(next.pendingDigest).toBeNull();
  });

  it('reports failed checks under checks and passes only under checks:all', () => {
    const checks = [
      checkRun('build', 'failed', T0 - 10 * MIN),
      checkRun('lint', 'passed', T0 - 10 * MIN),
    ];

    const plain = apply(watch(), { checks }, T0);
    const all = apply(watch({ kinds: ['checks', 'checks:all', 'closed'] }), { checks }, T0);

    expect(plain.pendingDigest?.line).toBe('#7 acme/widgets: checks failed: build');
    expect(all.pendingDigest?.line).toBe(
      '#7 acme/widgets: checks failed: build, checks passed: lint',
    );
  });

  it('drops ignored authors case-insensitively but keeps bots', () => {
    const next = apply(
      watch(),
      {
        issueComments: [
          comment('Dependabot', T0 - 10 * MIN),
          comment('coderabbitai[bot]', T0 - 10 * MIN),
        ],
      },
      T0,
      { ...settings, ignoreAuthors: ['dependabot'] },
    );

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: 1 comment');
  });
});

describe('items behind the counts', () => {
  it('records an item only where its count is bumped', () => {
    const w = watch({ kinds: ['comment', 'closed'] });
    const kept = comment('alice', T0 - MIN);

    const held = apply(
      w,
      {
        issueComments: [kept, comment('Bot', T0 - MIN)],
        reviews: [review('alice', T0 - MIN)],
        checks: [checkRun('build', 'failed', T0 - MIN)],
        conflict: { headSha: 'sha1' },
      },
      T0,
      { ...settings, ignoreAuthors: ['bot'] },
    );

    const items = readCursor(held.cursor)?.fresh.items;
    expect(items?.issueComments.map((c) => c.id)).toEqual([kept.id]);
    expect(items).toMatchObject({ reviews: [], checkRuns: [], statuses: [], conflicts: [] });
  });
});

describe('quiet window and coalescing', () => {
  it('holds activity inside the window without a digest, then publishes once past it', () => {
    const held = apply(watch(), { issueComments: [comment('a', T0 - MIN)] }, T0);
    const ready = apply(held, {}, T0 + 3 * MIN);

    expect(held.pendingDigest).toBeNull();
    expect(readCursor(held.cursor)?.fresh.comments).toBe(1);
    expect(ready.pendingDigest).toMatchObject({
      line: '#7 acme/widgets: 1 comment',
      createdAt: T0 + 3 * MIN,
    });
  });

  it('folds further activity into one combined line under a new id', () => {
    const first = apply(watch(), { issueComments: [comment('a', T0 - 10 * MIN)] }, T0);
    const second = apply(first, { reviews: [review('b', T0 + 5 * MIN)] }, T0 + 10 * MIN);

    expect(second.pendingDigest?.line).toBe('#7 acme/widgets: 1 review (b), 1 comment');
    expect(second.pendingDigest?.id).not.toBe(first.pendingDigest?.id);
    expect(second.pendingDigest?.createdAt).toBe(T0 + 10 * MIN);
  });

  it('keeps the pending digest untouched while later activity is still inside its window', () => {
    const first = apply(watch(), { issueComments: [comment('a', T0 - 10 * MIN)] }, T0);

    const second = apply(first, { issueComments: [comment('b', T0 + MIN)] }, T0 + 2 * MIN);

    expect(second.pendingDigest).toBe(first.pendingDigest);
  });

  it('counts only new activity once the digest was acknowledged', () => {
    const first = apply(watch(), { issueComments: [comment('a', T0 - 10 * MIN)] }, T0);
    const acked = { ...first, pendingDigest: null };

    const next = apply(acked, { reviews: [review('b', T0 + MIN)] }, T0 + 10 * MIN);

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: 1 review (b)');
  });

  it('starts a conflict quiet window when it is seen', () => {
    const seen = apply(watch(), { conflict: { headSha: 'sha1' } }, T0);
    const ready = apply(seen, {}, T0 + 3 * MIN);

    expect(seen.pendingDigest).toBeNull();
    expect(ready.pendingDigest?.line).toBe('#7 acme/widgets: merge conflict');
  });
});

describe('closing', () => {
  it('publishes the final digest at once, folding in activity still inside the window', () => {
    const held = apply(watch(), { issueComments: [comment('a', T0 - MIN)] }, T0);

    const closed = apply(held, { closed: { merged: true } }, T0 + MIN);

    expect(closed.status).toBe('closed');
    expect(closed.pendingDigest?.line).toBe('#7 acme/widgets: 1 comment, merged');
  });

  it('yields a closed-only digest for an unmerged close', () => {
    const closed = apply(watch(), { closed: { merged: false } }, T0);

    expect(closed.pendingDigest?.line).toBe('#7 acme/widgets: closed');
  });
});

describe('status and identity', () => {
  it('returns the same watch when a poll finds nothing new', () => {
    const settled = apply(watch(), {}, T0);

    expect(apply(settled, {}, T0 + MIN)).toBe(settled);
  });

  it('recovers from error on a successful observation, clearing the reason', () => {
    const recovered = apply(
      watch({ status: 'error', errorReason: 'gh is not logged in.' }),
      {},
      T0,
    );

    expect(recovered.status).toBe('active');
    expect('errorReason' in recovered).toBe(false);
  });

  it('clears the reason when a PR closes out of error', () => {
    const closed = apply(
      watch({ status: 'error', errorReason: 'x' }),
      { closed: { merged: true } },
      T0,
    );

    expect(closed.status).toBe('closed');
    expect('errorReason' in closed).toBe(false);
  });

  it('replaces the reason of a watch already in error and leaves a same-reason one untouched', () => {
    const errored = markWatchError(watch(), 'a');

    expect(errored).toMatchObject({ status: 'error', errorReason: 'a' });
    expect(markWatchError(errored, 'a')).toBe(errored);
    expect(markWatchError(errored, 'b').errorReason).toBe('b');
  });

  it('leaves a closed watch alone', () => {
    const closed = watch({ status: 'closed' });

    expect(apply(closed, { issueComments: [comment('a', 0)] }, T0)).toBe(closed);
  });

  it('keeps the digest and tally when marking an error', () => {
    const held = apply(watch(), { issueComments: [comment('a', T0 - MIN)] }, T0);

    const errored = markWatchError(held, 'why');

    expect(errored).toMatchObject({ status: 'error', pendingDigest: null, cursor: held.cursor });
  });
});

describe('formatDigestLine', () => {
  it('pluralises and orders the segments', () => {
    const tally = {
      ...emptyTally(),
      reviews: 2,
      reviewAuthors: ['coderabbitai[bot]', 'alice'],
      comments: 3,
      checksFailed: ['build'],
      conflict: true,
    };

    expect(formatDigestLine('helloextend/foo', 241, tally, { merged: false })).toBe(
      '#241 helloextend/foo: 2 reviews (coderabbitai[bot], alice), 3 comments, checks failed: build, merge conflict, closed',
    );
  });
});
