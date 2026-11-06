import type { ReviewItem, ReviewQueue } from '@garden/shared';
import { joinLinks } from '../domain/reviews.js';
import type { Projection } from './projection.js';

export interface ReviewStore {
  queue(): ReviewQueue;
  /** The queued item with this key, with its link joined; undefined when it is not queued. */
  item(key: string): ReviewItem | undefined;
  /** Calls `listener` with the new queue after every change. */
  subscribe(listener: (queue: ReviewQueue) => void): () => void;
  /** A complete poll: replaces the items wholesale and clears the fault. */
  complete(items: ReviewItem[], polledAt: string): void;
  /** A failed poll: the previous items and `polledAt` stay. */
  fail(fault: NonNullable<ReviewQueue['fault']>): void;
  /** Records that `sessionId` is the session for the request `key` and persists it. */
  link(key: string, sessionId: string): void;
  /** Removes the item now and keeps it out of the queue until a complete poll no longer lists it,
   *  so a search index that lags the GitHub change cannot bring it back. */
  dismiss(key: string): void;
}

/**
 * The review queue, in memory: empty after a restart until the first complete poll. The links
 * to sessions are the one persisted part and this store is their only writer, so it reads them
 * once and holds them. A link is joined onto an item by key and never pruned: not when the PR
 * leaves the search results, and not when the session is missing from the projection.
 */
export function createReviewStore(deps: {
  readonly overlay: Pick<Projection, 'overlay' | 'updateOverlay'>;
}): ReviewStore {
  let links: Readonly<Record<string, string>> = deps.overlay.overlay().reviews.links;
  let polled: ReviewQueue = { items: [], polledAt: null, fault: null };
  let queue = polled;
  const listeners = new Set<(queue: ReviewQueue) => void>();
  const suppressed = new Set<string>();

  const publish = (next: ReviewQueue) => {
    polled = next;
    const visible = next.items.filter((item) => !suppressed.has(item.key));
    queue = { ...next, items: joinLinks(visible, links) };
    for (const listener of listeners) listener(queue);
  };

  return {
    queue: () => queue,
    item: (key) => queue.items.find((candidate) => candidate.key === key),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    complete(items, polledAt) {
      const listed = new Set(items.map((item) => item.key));
      for (const key of suppressed) if (!listed.has(key)) suppressed.delete(key);
      publish({ items, polledAt, fault: null });
    },
    fail(fault) {
      if (polled.fault === fault) return;
      publish({ ...polled, fault });
    },
    link(key, sessionId) {
      const next = { ...links, [key]: sessionId };
      deps.overlay.updateOverlay((base) => ({
        ...base,
        reviews: { ...base.reviews, links: next },
      }));
      links = next;
      publish(polled);
    },
    dismiss(key) {
      suppressed.add(key);
      publish(polled);
    },
  };
}
