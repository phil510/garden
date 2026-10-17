import type { DigestItems } from '@garden/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyObservation, formatDigestLine, markWatchError } from './digest.js';
import type { DigestSettings } from './digest.js';
import { emptyCursor, emptyTally, emptyTracking, readCursor } from './pollCursor.js';
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
const status = (name: string, outcome: 'failed' | 'passed', at: number) => ({
  kind: 'status' as const,
  name,
  state: outcome === 'failed' ? 'failure' : 'success',
  outcome,
  at,
  headSha: 'sha1',
});

let counter = 0;
beforeEach(() => {
  counter = 0;
});
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

    expect(plain.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] checks failed: build');
    expect(all.pendingDigest?.line).toBe(
      '#7 acme/widgets: [digest d2] checks failed: build, checks passed: lint',
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

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] 1 comment');
  });

  describe('ignored checks', () => {
    const all = (ignoredChecks: string[]) =>
      watch({ kinds: ['checks', 'checks:all', 'closed'], ignoredChecks });

    it('mints nothing for an ignored failing check run', () => {
      const w = watch({ ignoredChecks: ['cve-scan'] });
      const next = apply(w, { checks: [checkRun('cve-scan', 'failed', T0 - 10 * MIN)] }, T0);
      expect(next.pendingDigest).toBeNull();
    });

    it('mints nothing for an ignored passing check under checks:all', () => {
      const next = apply(
        all(['lint']),
        { checks: [checkRun('lint', 'passed', T0 - 10 * MIN)] },
        T0,
      );
      expect(next.pendingDigest).toBeNull();
    });

    it('mints nothing for an ignored commit status context', () => {
      const next = apply(
        watch({ ignoredChecks: ['ci/x'] }),
        { checks: [status('ci/x', 'failed', T0 - 10 * MIN)] },
        T0,
      );
      expect(next.pendingDigest).toBeNull();
    });

    it('still reports other checks and leaves the ignored one out of line and items', () => {
      const next = apply(
        watch({ ignoredChecks: ['cve-scan', 'ci/x'] }),
        {
          checks: [
            checkRun('cve-scan', 'failed', T0 - 10 * MIN),
            status('ci/x', 'failed', T0 - 10 * MIN),
            checkRun('build', 'failed', T0 - 10 * MIN),
          ],
        },
        T0,
      );
      expect(next.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] checks failed: build');
      const items = next.pendingDigest?.detail?.items;
      expect(items?.checkRuns.map((c) => c.name)).toEqual(['build']);
      expect(items?.statuses).toEqual([]);
    });

    it('matches names case-sensitively', () => {
      const next = apply(
        watch({ ignoredChecks: ['Build'] }),
        { checks: [checkRun('build', 'failed', T0 - 10 * MIN)] },
        T0,
      );
      expect(next.pendingDigest?.line).toContain('checks failed: build');
    });

    it('does not move the quiet window of earlier activity', () => {
      const held = apply(watch(), { issueComments: [comment('a', T0 - 2 * MIN)] }, T0 - MIN);
      expect(held.pendingDigest).toBeNull();
      const muted = { ...held, ignoredChecks: ['cve-scan'] };
      const next = apply(
        muted,
        { checks: [checkRun('cve-scan', 'failed', T0 + MIN)] },
        T0 + 2 * MIN,
      );
      expect(next.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] 1 comment');
    });
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
      line: '#7 acme/widgets: [digest d1] 1 comment',
      createdAt: T0 + 3 * MIN,
    });
  });

  it('folds further activity into one combined line under a new id', () => {
    const first = apply(watch(), { issueComments: [comment('a', T0 - 10 * MIN)] }, T0);
    const second = apply(first, { reviews: [review('b', T0 + 5 * MIN)] }, T0 + 10 * MIN);

    expect(second.pendingDigest?.line).toBe('#7 acme/widgets: [digest d2] 1 review (b), 1 comment');
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

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: [digest d2] 1 review (b)');
  });

  it('starts a conflict quiet window when it is seen', () => {
    const seen = apply(watch(), { conflict: { headSha: 'sha1' } }, T0);
    const ready = apply(seen, {}, T0 + 3 * MIN);

    expect(seen.pendingDigest).toBeNull();
    expect(ready.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] merge conflict');
  });
});

describe('closing', () => {
  it('publishes the final digest at once, folding in activity still inside the window', () => {
    const held = apply(watch(), { issueComments: [comment('a', T0 - MIN)] }, T0);

    const closed = apply(held, { closed: { merged: true } }, T0 + MIN);

    expect(closed.status).toBe('closed');
    expect(closed.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] 1 comment, merged');
  });

  it('yields a closed-only digest for an unmerged close', () => {
    const closed = apply(watch(), { closed: { merged: false } }, T0);

    expect(closed.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] closed');
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

    expect(formatDigestLine('helloextend/foo', 241, '3f9a2c7b01de', tally, { merged: false })).toBe(
      '#241 helloextend/foo: [digest 3f9a2c7b01de] 2 reviews (coderabbitai[bot], alice), 3 comments, checks failed: build, merge conflict, closed',
    );
  });
});

describe('digest detail', () => {
  const OLD = T0 - 10 * MIN;
  const uniq = (names: string[]) => [...new Set(names)];

  /** Recomputes the count fields of a tally from its items, as an independent reader would. */
  const countsOf = (items: DigestItems) => {
    const checks = [...items.checkRuns, ...items.statuses];
    const names = (outcome: 'failed' | 'passed') =>
      uniq([
        ...items.checkRuns.filter((c) => c.outcome === outcome).map((c) => c.name),
        ...items.statuses.filter((c) => c.outcome === outcome).map((c) => c.context),
      ]);
    expect(checks.length).toBe(items.checkRuns.length + items.statuses.length);
    return {
      reviews: items.reviews.length,
      reviewAuthors: uniq(items.reviews.map((r) => r.author)),
      comments: items.issueComments.length + items.reviewComments.length,
      checksFailed: names('failed'),
      checksPassed: names('passed'),
      conflict: items.conflicts.length > 0,
    };
  };

  /** The detail on `w`'s pending digest must be exactly what the published tally and line count. */
  function expectExact(w: Watch) {
    const pending = w.pendingDigest;
    const tally = readCursor(w.cursor)?.written;
    const detail = pending?.detail;
    if (pending === null || tally === undefined || detail === undefined)
      throw new Error('expected a pending digest with a detail');
    const { reviews, reviewAuthors, comments, checksFailed, checksPassed, conflict } = tally;
    expect(countsOf(detail.items)).toEqual({
      reviews,
      reviewAuthors,
      comments,
      checksFailed,
      checksPassed,
      conflict,
    });
    expect(formatDigestLine(w.repo, w.pr, pending.id, tally, detail.closed)).toBe(pending.line);
    expect(detail).toMatchObject({ id: pending.id, line: pending.line, repo: w.repo, pr: w.pr });
    return detail;
  }

  const reviewComment = (login: string, at: number, reviewId: number | null = null) => ({
    id: ++itemId,
    login,
    reviewId,
    at,
  });
  const status = (context: string, outcome: 'failed' | 'passed', at: number) => ({
    kind: 'status' as const,
    name: context,
    state: outcome === 'failed' ? 'failure' : 'success',
    outcome,
    at,
    headSha: 'sha1',
  });

  it('holds no comment and no passed-check items for a watch that wants neither', () => {
    const w = watch({ kinds: ['review', 'checks', 'closed'] });

    const next = apply(
      w,
      {
        reviews: [review('alice', OLD)],
        issueComments: [comment('alice', OLD)],
        reviewComments: [reviewComment('alice', OLD, 3)],
        checks: [
          checkRun('build', 'failed', OLD),
          checkRun('lint', 'passed', OLD),
          status('ci/x', 'failed', OLD),
        ],
      },
      T0,
    );

    const detail = expectExact(next);
    expect(detail.items.issueComments).toEqual([]);
    expect(detail.items.reviewComments).toEqual([]);
    expect(detail.items.checkRuns.map((c) => c.name)).toEqual(['build']);
    expect(detail.items.statuses.map((c) => c.context)).toEqual(['ci/x']);
  });

  it('drops an ignored author case-insensitively from reviews and both kinds of comment', () => {
    const next = apply(
      watch(),
      {
        reviews: [review('BOT', OLD), review('alice', OLD)],
        issueComments: [comment('Bot', OLD), comment('alice', OLD)],
        reviewComments: [reviewComment('bOt', OLD), reviewComment('alice', OLD, 3)],
      },
      T0,
      { ...settings, ignoreAuthors: ['bot'] },
    );

    const detail = expectExact(next);
    expect(detail.items.reviews.map((r) => r.author)).toEqual(['alice']);
    expect(detail.items.issueComments.map((c) => c.author)).toEqual(['alice']);
    expect(detail.items.reviewComments).toMatchObject([{ author: 'alice', reviewId: 3 }]);
  });

  it('carries the first digest items into a re-mint and names the id it replaces', () => {
    const first = apply(watch(), { issueComments: [comment('a', OLD)] }, T0);
    const second = apply(first, { reviews: [review('b', T0 + 5 * MIN)] }, T0 + 10 * MIN);

    const detail = expectExact(second);

    expect(detail.replaces).toBe(first.pendingDigest?.id);
    expect(detail.items.issueComments).toHaveLength(1);
    expect(detail.items.reviews).toHaveLength(1);
  });

  it('holds only new items once the earlier digest was acknowledged', () => {
    const first = apply(watch(), { issueComments: [comment('a', OLD)] }, T0);
    const acked = { ...first, pendingDigest: null };

    const next = apply(acked, { reviews: [review('b', T0 + MIN)] }, T0 + 10 * MIN);

    const detail = expectExact(next);
    expect(detail.replaces).toBeNull();
    expect(detail.items.issueComments).toEqual([]);
    expect(detail.items.reviews).toHaveLength(1);
  });

  it('keeps both transitions of a check re-run in place while the line names it once', () => {
    const next = apply(
      watch(),
      { checks: [checkRun('build', 'failed', OLD), checkRun('build', 'failed', OLD + MIN)] },
      T0,
    );

    const detail = expectExact(next);
    expect(detail.items.checkRuns).toHaveLength(2);
    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] checks failed: build');
  });

  it('records a close on the detail and still ends the line with merged', () => {
    const held = apply(watch(), { issueComments: [comment('a', T0 - MIN)] }, T0);

    const closed = apply(held, { closed: { merged: true } }, T0 + MIN);

    const detail = expectExact(closed);
    expect(detail.closed).toEqual({ merged: true });
    expect(closed.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] 1 comment, merged');
    expect(detail.items.issueComments).toHaveLength(1);
  });

  it('records the sha and mergeability of the poll that minted it', () => {
    const tracking = emptyTracking();
    const observation: Observation = {
      activity: { ...none, conflict: { headSha: 'abc' } },
      tracking: { ...tracking, pr: { ...tracking.pr, headSha: 'abc', mergeable: false } },
    };

    const next = applyObservation(watch(), observation, settings, T0, mint);
    const held = applyObservation(
      next,
      { ...observation, activity: none },
      settings,
      T0 + 3 * MIN,
      mint,
    );

    expect(held.pendingDigest?.detail).toMatchObject({
      atMint: { headSha: 'abc', mergeable: false },
      createdAt: new Date(T0 + 3 * MIN).toISOString(),
      items: { conflicts: [{ headSha: 'abc', seenAt: new Date(T0).toISOString() }] },
    });
  });

  it('builds no detail when a tally with unknown items is folded, and the line stays right', () => {
    const legacyTally: Record<string, unknown> = { ...emptyTally(), comments: 1 };
    delete legacyTally['items'];
    const cursor = JSON.parse(
      JSON.stringify({ ...emptyCursor(), written: legacyTally, fresh: emptyTally() }),
    ) as { fresh: Record<string, unknown> };
    delete cursor.fresh['items'];
    const w = watch({
      cursor,
      pendingDigest: { id: 'old', line: '#7 acme/widgets: 1 comment', createdAt: OLD },
    });

    const next = apply(w, { issueComments: [comment('a', OLD)] }, T0);

    expect(next.pendingDigest?.line).toBe('#7 acme/widgets: [digest d1] 2 comments');
    expect(next.pendingDigest?.detail).toBeUndefined();
  });

  it('holds no PR content in any item', () => {
    const held = apply(
      watch({ kinds: ['review', 'comment', 'checks', 'checks:all', 'conflict', 'closed'] }),
      {
        reviews: [review('a', OLD)],
        issueComments: [comment('a', OLD)],
        reviewComments: [reviewComment('a', OLD, 3)],
        checks: [checkRun('build', 'failed', OLD), status('ci/x', 'passed', OLD)],
        conflict: { headSha: 'sha1' },
      },
      T0,
    );
    const next = apply(held, {}, T0 + 3 * MIN);

    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (typeof value === 'object' && value !== null)
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          collect(inner);
        }
    };
    collect(next.pendingDigest?.detail);

    expect(keys.size).toBeGreaterThan(0);
    for (const forbidden of ['body', 'title', 'text']) expect(keys.has(forbidden)).toBe(false);
  });
});
