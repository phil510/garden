import type { ReviewQueue } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { GhResult } from '../domain/github.js';
import { searchResponse } from '../domain/reviews.fixture.js';
import { createReviewPoller, REVIEW_SEARCH_PATH } from './reviewPoller.js';
import { createReviewStore } from './reviews.js';
import { memoryOverlay } from './reviews.fixture.js';

const T0 = Date.parse('2026-01-10T00:00:00Z');

const complete: GhResult = {
  kind: 'ok',
  etag: null,
  body: { ...(searchResponse as object), total_count: 3 },
};

function setup() {
  const calls: { path: string; etag: string | null }[] = [];
  let answer: () => GhResult = () => complete;
  let clock = T0;
  const store = createReviewStore({ overlay: memoryOverlay() });
  const clonePaths = new Map<string, string>();
  const logged: string[] = [];
  const poller = createReviewPoller({
    gh: {
      removeReviewRequest: () => Promise.reject(new Error('not used by this test')),
      get(path, etag) {
        calls.push({ path, etag });
        try {
          return Promise.resolve(answer());
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    },
    store,
    clones: {
      resolve: (repos) =>
        Promise.resolve(new Map(repos.map((r) => [r, clonePaths.get(r) ?? null]))),
    },
    config: { read: () => ({ pollIntervalMinutes: 5 }) as never },
    logger: { warn: (m) => logged.push(m), error: (m) => logged.push(m) },
    now: () => clock,
  });
  return {
    poller,
    store,
    clonePaths,
    calls,
    logged,
    answer(next: () => GhResult) {
      answer = next;
    },
    advance(ms: number) {
      clock += ms;
    },
  };
}

describe('review poller', () => {
  it('searches for direct review requests with an encoded query and no etag', async () => {
    const t = setup();
    await t.poller.tick();
    expect(t.calls).toHaveLength(1);
    const url = new URL(`https://x/${REVIEW_SEARCH_PATH}`);
    expect(url.searchParams.get('q')).toBe(
      'is:open is:pr archived:false user-review-requested:@me',
    );
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(t.calls[0]?.etag).toBeNull();
  });

  it('stores a complete poll with its time', async () => {
    const t = setup();
    await t.poller.tick();
    expect(t.store.queue().items.map((i) => i.number)).toEqual([378, 376, 374]);
    expect(t.store.queue().polledAt).toBe(new Date(T0).toISOString());
    expect(t.store.queue().fault).toBeNull();
  });

  it("sets each item's clone path from the resolver, null when there is none", async () => {
    const t = setup();
    await t.poller.tick();
    expect(t.store.queue().items.map((i) => i.clonePath)).toEqual([null, null, null]);
    t.clonePaths.set('phil510/garden', '/r/garden');
    t.advance(60_000 * 10);
    await t.poller.tick();
    expect(t.store.queue().items.map((i) => i.clonePath)).toEqual(Array(3).fill('/r/garden'));
  });

  const failures: [string, () => GhResult, NonNullable<ReviewQueue['fault']>][] = [
    ['gh missing', () => ({ kind: 'unavailable', reason: 'missing' }), 'gh-missing'],
    ['gh logged out', () => ({ kind: 'unavailable', reason: 'logged-out' }), 'logged-out'],
    ['a rate limit', () => ({ kind: 'rate-limited', resumeAt: T0 + 1000 }), 'rate-limited'],
    ['an inaccessible search', () => ({ kind: 'inaccessible', status: 403 }), 'error'],
    ['a malformed body', () => ({ kind: 'ok', etag: null, body: {} }), 'error'],
    [
      'an incomplete response',
      () => ({
        kind: 'ok',
        etag: null,
        body: { ...(complete as { body: object }).body, incomplete_results: true },
      }),
      'incomplete',
    ],
    [
      'more than 100 matches',
      () => ({
        kind: 'ok',
        etag: null,
        body: { ...(complete as { body: object }).body, total_count: 101 },
      }),
      'incomplete',
    ],
    [
      'a thrown call',
      () => {
        throw new Error('timeout');
      },
      'error',
    ],
  ];

  it.each(failures)(
    'keeps the previous items and sets the fault on %s',
    async (_n, next, fault) => {
      const t = setup();
      await t.poller.tick();
      const before = t.store.queue();
      t.advance(60_000 * 10);
      t.answer(next);
      await expect(t.poller.tick()).resolves.toBeUndefined();
      expect(t.store.queue()).toEqual({ ...before, fault });
    },
  );

  it('makes no calls while held for a rate limit and searches again after resumeAt', async () => {
    const t = setup();
    t.answer(() => ({ kind: 'rate-limited', resumeAt: T0 + 60_000 }));
    await t.poller.tick();
    t.answer(() => complete);
    t.advance(59_999);
    await t.poller.tick();
    expect(t.calls).toHaveLength(1);
    expect(t.store.queue().fault).toBe('rate-limited');
    t.advance(1);
    await t.poller.tick();
    expect(t.calls).toHaveLength(2);
    expect(t.store.queue().fault).toBeNull();
  });

  it('logs a persistent incomplete or error fault', async () => {
    const t = setup();
    t.answer(() => ({ kind: 'inaccessible', status: 404 }));
    await t.poller.tick();
    expect(t.logged.join('\n')).toContain('error');
  });

  it('drops the answer of a search that was in flight when the poller stopped', async () => {
    let release: (result: GhResult) => void = () => undefined;
    const store = createReviewStore({ overlay: memoryOverlay() });
    const poller = createReviewPoller({
      gh: {
        removeReviewRequest: () => Promise.reject(new Error('not used by this test')),
        get: () => new Promise<GhResult>((resolve) => (release = resolve)),
      },
      store,
      clones: { resolve: () => Promise.resolve(new Map()) },
      config: { read: () => ({ pollIntervalMinutes: 5 }) as never },
      logger: { warn: () => undefined, error: () => undefined },
      now: () => T0,
    });
    const ticking = poller.tick();
    poller.stop();
    release(complete);
    await ticking;
    expect(store.queue()).toEqual({ items: [], polledAt: null, fault: null });
  });
});
