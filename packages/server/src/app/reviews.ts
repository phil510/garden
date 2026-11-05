import type { ReviewItem, ReviewQueue } from '@garden/shared';

export interface ReviewStore {
  queue(): ReviewQueue;
  /** Calls `listener` with the new queue after every change. */
  subscribe(listener: (queue: ReviewQueue) => void): () => void;
  /** A complete poll: replaces the items wholesale and clears the fault. */
  complete(items: ReviewItem[], polledAt: string): void;
  /** A failed poll: the previous items and `polledAt` stay. */
  fail(fault: NonNullable<ReviewQueue['fault']>): void;
}

/** The review queue, in memory: empty after a restart until the first complete poll. */
export function createReviewStore(): ReviewStore {
  let queue: ReviewQueue = { items: [], polledAt: null, fault: null };
  const listeners = new Set<(queue: ReviewQueue) => void>();

  const set = (next: ReviewQueue) => {
    queue = next;
    for (const listener of listeners) listener(queue);
  };

  return {
    queue: () => queue,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    complete(items, polledAt) {
      set({ items, polledAt, fault: null });
    },
    fail(fault) {
      if (queue.fault === fault) return;
      set({ ...queue, fault });
    },
  };
}
