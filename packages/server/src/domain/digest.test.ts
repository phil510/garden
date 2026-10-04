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

const none: Activity = { reviews: [], comments: [], checks: [], conflict: false, closed: null };
const observe = (activity: Partial<Activity> = {}): Observation => ({
  activity: { ...none, ...activity },
  tracking: emptyTracking(),
});
const comment = (login: string, at: number) => ({ login, at });
const review = (login: string, at: number, hasBody = true, hasInlineComments = false) => ({
  login,
  at,
  hasBody,
  hasInlineComments,
});

let counter = 0;
const mint = () => `d${String(++counter)}`;

function apply(w: Watch, activity: Partial<Activity>, now: number, s = settings): Watch {
  return applyObservation(w, observe(activity), s, now, mint);
}

describe('kinds and filters', () => {
  it('ignores comments for a watch without the comment kind', () => {
    const w = watch({ kinds: ['review', 'closed'] });

    const next = apply(w, { comments: [comment('a', T0 - 10 * MIN)] }, T0);

    expect(next.pendingDigest).toBeNull();
  });

  it('reports failed checks under checks and passes only under checks:all', () => {
    const checks = [
      { name: 'build', outcome: 'failed' as const, at: T0 - 10 * MIN },
      { name: 'lint', outcome: 'passed' as const, at: T0 - 10 * MIN },
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
        comments: [
          comment('Dependabot', T0 - 10 * MIN),
          comment('coderabbitai[bot]', T0 - 10 * MIN),
        ],
      },
      T0,
      { ...settings, ignoreAuthors: ['dependabot'] },
    );

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: 1 comment');
  });

  it('drops a review with no body and no inline comments, and keeps one with inline comments', () => {
    const next = apply(
      watch(),
      { reviews: [review('a', T0 - 10 * MIN, false), review('b', T0 - 10 * MIN, false, true)] },
      T0,
    );

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: 1 review (b)');
  });
});

describe('quiet window and coalescing', () => {
  it('holds activity inside the window without a digest, then publishes once past it', () => {
    const held = apply(watch(), { comments: [comment('a', T0 - MIN)] }, T0);
    const ready = apply(held, {}, T0 + 3 * MIN);

    expect(held.pendingDigest).toBeNull();
    expect(readCursor(held.cursor)?.fresh.comments).toBe(1);
    expect(ready.pendingDigest).toMatchObject({
      line: '#7 acme/widgets: 1 comment',
      createdAt: T0 + 3 * MIN,
    });
  });

  it('folds further activity into one combined line under a new id', () => {
    const first = apply(watch(), { comments: [comment('a', T0 - 10 * MIN)] }, T0);
    const second = apply(first, { reviews: [review('b', T0 + 5 * MIN)] }, T0 + 10 * MIN);

    expect(second.pendingDigest?.line).toBe('#7 acme/widgets: 1 review (b), 1 comment');
    expect(second.pendingDigest?.id).not.toBe(first.pendingDigest?.id);
    expect(second.pendingDigest?.createdAt).toBe(T0 + 10 * MIN);
  });

  it('keeps the pending digest untouched while later activity is still inside its window', () => {
    const first = apply(watch(), { comments: [comment('a', T0 - 10 * MIN)] }, T0);

    const second = apply(first, { comments: [comment('b', T0 + MIN)] }, T0 + 2 * MIN);

    expect(second.pendingDigest).toBe(first.pendingDigest);
  });

  it('counts only new activity once the digest was acknowledged', () => {
    const first = apply(watch(), { comments: [comment('a', T0 - 10 * MIN)] }, T0);
    const acked = { ...first, pendingDigest: null };

    const next = apply(acked, { reviews: [review('b', T0 + MIN)] }, T0 + 10 * MIN);

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: 1 review (b)');
  });

  it('treats a digest with a different id than the one written as acknowledged', () => {
    const first = apply(watch(), { comments: [comment('a', T0 - 10 * MIN)] }, T0);
    const replaced = {
      ...first,
      pendingDigest: { id: 'other', line: 'x', createdAt: T0 },
    };

    const next = apply(replaced, { reviews: [review('b', T0 + MIN)] }, T0 + 10 * MIN);

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: 1 review (b)');
  });

  it('starts a conflict quiet window when it is seen', () => {
    const seen = apply(watch(), { conflict: true }, T0);
    const ready = apply(seen, {}, T0 + 3 * MIN);

    expect(seen.pendingDigest).toBeNull();
    expect(ready.pendingDigest?.line).toBe('#7 acme/widgets: merge conflict');
  });
});

describe('closing', () => {
  it('publishes the final digest at once, folding in activity still inside the window', () => {
    const held = apply(watch(), { comments: [comment('a', T0 - MIN)] }, T0);

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

  it('recovers from error on a successful observation', () => {
    expect(apply(watch({ status: 'error' }), {}, T0).status).toBe('active');
  });

  it('leaves a closed watch alone', () => {
    const closed = watch({ status: 'closed' });

    expect(apply(closed, { comments: [comment('a', 0)] }, T0)).toBe(closed);
  });

  it('keeps the digest and tally when marking an error', () => {
    const held = apply(watch(), { comments: [comment('a', T0 - MIN)] }, T0);

    const errored = markWatchError(held);

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
