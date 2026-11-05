import type { ReviewItem, ReviewQueue } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { createReviewStore } from './reviews.js';
import { memoryOverlay } from './reviews.fixture.js';

const item = (number: number): ReviewItem => ({
  key: `acme/widgets#${String(number)}`,
  repo: 'acme/widgets',
  number,
  title: `PR ${String(number)}`,
  author: 'octocat',
  url: `https://github.com/acme/widgets/pull/${String(number)}`,
  draft: false,
  updatedAt: '2026-01-10T00:00:00Z',
  clonePath: null,
  sessionId: null,
});

const POLLED = '2026-01-10T00:05:00Z';

describe('review store', () => {
  it('starts empty and unpolled', () => {
    expect(createReviewStore({ overlay: memoryOverlay() }).queue()).toEqual({
      items: [],
      polledAt: null,
      fault: null,
    });
  });

  it('replaces the items wholesale on a complete poll and clears the fault', () => {
    const store = createReviewStore({ overlay: memoryOverlay() });
    store.complete([item(1), item(2)], POLLED);
    store.fail('error');
    store.complete([item(3)], '2026-01-10T00:10:00Z');
    expect(store.queue()).toEqual({
      items: [item(3)],
      polledAt: '2026-01-10T00:10:00Z',
      fault: null,
    });
  });

  it.each(['gh-missing', 'logged-out', 'rate-limited', 'incomplete', 'error'] as const)(
    'keeps the previous items and polledAt on a %s failure',
    (fault) => {
      const store = createReviewStore({ overlay: memoryOverlay() });
      store.complete([item(1)], POLLED);
      store.fail(fault);
      expect(store.queue()).toEqual({ items: [item(1)], polledAt: POLLED, fault });
    },
  );

  it('notifies on every complete poll and on a changed fault only', () => {
    const store = createReviewStore({ overlay: memoryOverlay() });
    const seen: ReviewQueue[] = [];
    store.subscribe((queue) => seen.push(queue));
    store.complete([item(1)], POLLED);
    store.complete([item(1)], '2026-01-10T00:10:00Z');
    store.fail('error');
    store.fail('error');
    store.fail('rate-limited');
    expect(seen.map((q) => q.fault)).toEqual([null, null, 'error', 'rate-limited']);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createReviewStore({ overlay: memoryOverlay() });
    const seen: ReviewQueue[] = [];
    const unsubscribe = store.subscribe((queue) => seen.push(queue));
    unsubscribe();
    store.complete([item(1)], POLLED);
    expect(seen).toEqual([]);
  });

  describe('links', () => {
    it('joins the links read at construction onto the items', () => {
      const store = createReviewStore({ overlay: memoryOverlay({ [item(1).key]: 'session-1' }) });
      store.complete([item(1), item(2)], POLLED);
      expect(store.queue().items.map((i) => i.sessionId)).toEqual(['session-1', null]);
      expect(store.item(item(1).key)?.sessionId).toBe('session-1');
      expect(store.item('acme/widgets#9')).toBeUndefined();
    });

    it('keeps a link while its PR is out of the results and joins it again when it returns', () => {
      const store = createReviewStore({ overlay: memoryOverlay({ [item(1).key]: 'session-1' }) });
      store.complete([item(1)], POLLED);
      store.complete([item(2)], POLLED);
      expect(store.queue().items.map((i) => i.sessionId)).toEqual([null]);
      store.complete([item(1)], POLLED);
      expect(store.queue().items[0]?.sessionId).toBe('session-1');
    });

    it('persists a new link, joins it and notifies subscribers', () => {
      const overlay = memoryOverlay({ [item(2).key]: 'session-2' });
      const store = createReviewStore({ overlay });
      store.complete([item(1), item(2)], POLLED);
      const seen: ReviewQueue[] = [];
      store.subscribe((queue) => seen.push(queue));
      store.link(item(1).key, 'session-1');
      expect(overlay.writes.at(-1)?.reviews.links).toEqual({
        [item(2).key]: 'session-2',
        [item(1).key]: 'session-1',
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.items.map((i) => i.sessionId)).toEqual(['session-1', 'session-2']);
    });
  });
});
