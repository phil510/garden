import type { ReviewItem, ReviewQueue } from '@garden/shared';
import type { GhResult } from './github.js';
import { normalizeRepo } from './watches.js';

/** One search page is the whole read: more matches than this and the queue is not complete. */
export const REVIEW_SEARCH_PAGE_SIZE = 100;

type Fault = NonNullable<ReviewQueue['fault']>;

export type ReviewPollOutcome =
  | { readonly kind: 'complete'; readonly items: ReviewItem[] }
  | { readonly kind: 'fault'; readonly fault: Fault };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `<owner>/<name>` from a `repository_url` such as `https://api.github.com/repos/o/n`. */
export function repoFromRepositoryUrl(url: string): string | null {
  const marker = '/repos/';
  const at = url.indexOf(marker);
  return at < 0 ? null : normalizeRepo(url.slice(at + marker.length));
}

function parseItem(raw: unknown): ReviewItem | null {
  if (!isRecord(raw)) return null;
  const { number, title, user, html_url: url, draft, updated_at: updatedAt } = raw;
  const repository = raw['repository_url'];
  if (
    typeof number !== 'number' ||
    typeof title !== 'string' ||
    !isRecord(user) ||
    typeof user['login'] !== 'string' ||
    typeof url !== 'string' ||
    typeof draft !== 'boolean' ||
    typeof updatedAt !== 'string' ||
    typeof repository !== 'string'
  )
    return null;
  const repo = repoFromRepositoryUrl(repository);
  if (repo === null) return null;
  return {
    key: `${repo}#${String(number)}`,
    repo,
    number,
    title,
    author: user['login'],
    url,
    draft,
    updatedAt,
    clonePath: null,
    sessionId: null,
  };
}

/**
 * A `search/issues` body as a review queue page, or null when it is not one. A malformed item
 * makes the whole body malformed: skipping it would drop a PR from the queue with no trace, and
 * it would later surface as new. `complete` is false when GitHub says the results are partial or
 * there are more matches than one page holds.
 */
export function parseReviewSearch(
  body: unknown,
): { complete: boolean; items: ReviewItem[] } | null {
  if (!isRecord(body)) return null;
  const { total_count: total, incomplete_results: incomplete, items: raw } = body;
  if (typeof total !== 'number' || typeof incomplete !== 'boolean' || !Array.isArray(raw))
    return null;
  const items: ReviewItem[] = [];
  for (const entry of raw) {
    const item = parseItem(entry);
    if (item === null) return null;
    items.push(item);
  }
  // ISO timestamps in one format order lexically.
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return { complete: !incomplete && total <= REVIEW_SEARCH_PAGE_SIZE, items };
}

/** What one search call means for the queue. A thrown call is the caller's to map to `error`. */
export function reviewPollOutcome(result: GhResult): ReviewPollOutcome {
  switch (result.kind) {
    case 'unavailable':
      return { kind: 'fault', fault: result.reason === 'missing' ? 'gh-missing' : 'logged-out' };
    case 'rate-limited':
      return { kind: 'fault', fault: 'rate-limited' };
    case 'ok': {
      const page = parseReviewSearch(result.body);
      if (page === null) return { kind: 'fault', fault: 'error' };
      return page.complete
        ? { kind: 'complete', items: page.items }
        : { kind: 'fault', fault: 'incomplete' };
    }
    // `not-modified` needs an etag, which a search request never sends.
    case 'inaccessible':
    case 'not-modified':
      return { kind: 'fault', fault: 'error' };
  }
}
