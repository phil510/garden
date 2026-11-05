import type { ReviewItem, ReviewQueue } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { createReviewStore } from './reviews.js';

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
    expect(createReviewStore().queue()).toEqual({ items: [], polledAt: null, fault: null });
  });

  it('replaces the items wholesale on a complete poll and clears the fault', () => {
    const store = createReviewStore();
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
      const store = createReviewStore();
      store.complete([item(1)], POLLED);
      store.fail(fault);
      expect(store.queue()).toEqual({ items: [item(1)], polledAt: POLLED, fault });
    },
  );

  it('notifies on every complete poll and on a changed fault only', () => {
    const store = createReviewStore();
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
    const store = createReviewStore();
    const seen: ReviewQueue[] = [];
    const unsubscribe = store.subscribe((queue) => seen.push(queue));
    unsubscribe();
    store.complete([item(1)], POLLED);
    expect(seen).toEqual([]);
  });

  describe('dismiss', () => {
    it('removes the item at once and notifies subscribers', () => {
      const store = createReviewStore();
      store.complete([item(1), item(2)], POLLED);
      const seen: ReviewQueue[] = [];
      store.subscribe((queue) => seen.push(queue));
      store.dismiss(item(1).key);
      expect(store.queue().items).toEqual([item(2)]);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.items).toEqual([item(2)]);
    });

    it('keeps the item out of a complete poll that still lists it', () => {
      const store = createReviewStore();
      store.complete([item(1), item(2)], POLLED);
      store.dismiss(item(1).key);
      store.complete([item(1), item(2)], '2026-01-10T00:10:00Z');
      expect(store.queue().items).toEqual([item(2)]);
    });

    it('lets the item back once a complete poll has stopped listing it', () => {
      const store = createReviewStore();
      store.complete([item(1), item(2)], POLLED);
      store.dismiss(item(1).key);
      store.complete([item(2)], '2026-01-10T00:10:00Z');
      store.complete([item(1), item(2)], '2026-01-10T00:15:00Z');
      expect(store.queue().items).toEqual([item(1), item(2)]);
    });

    it('is neither undone nor cleared by a failed poll', () => {
      const store = createReviewStore();
      store.complete([item(1), item(2)], POLLED);
      store.dismiss(item(1).key);
      store.fail('error');
      expect(store.queue().items).toEqual([item(2)]);
      store.complete([item(1), item(2)], '2026-01-10T00:10:00Z');
      expect(store.queue().items).toEqual([item(2)]);
    });

    it('is safe for a key a poll already dropped, and clears on the next complete poll', () => {
      const store = createReviewStore();
      store.complete([item(2)], POLLED);
      store.dismiss(item(1).key);
      expect(store.queue().items).toEqual([item(2)]);
      store.complete([item(2)], '2026-01-10T00:10:00Z');
      store.complete([item(1), item(2)], '2026-01-10T00:15:00Z');
      expect(store.queue().items).toEqual([item(1), item(2)]);
    });
  });
});
