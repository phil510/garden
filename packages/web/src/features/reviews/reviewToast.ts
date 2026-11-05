import type { ReviewQueue } from '@garden/shared';

/** The toast for requests that arrived between two queues, or null when there is nothing to
 *  announce. A previous queue that was never polled (no queue yet, or the first poll after a
 *  server restart) is a baseline, not a state to diff against: every item would look new. */
export function reviewToastMessage(prev: ReviewQueue | null, next: ReviewQueue): string | null {
  if (prev?.polledAt == null) return null;
  const known = new Set(prev.items.map((item) => item.key));
  const added = next.items.filter((item) => !known.has(item.key));
  const [first] = added;
  if (first === undefined) return null;
  if (added.length === 1)
    return `Review requested: ${first.repo}#${String(first.number)} — ${first.title}`;
  return `${String(added.length)} new review requests`;
}

/** Every item counts, whether or not a session is already linked to it. */
export function reviewCount(queue: ReviewQueue | null): number {
  return queue?.items.length ?? 0;
}
