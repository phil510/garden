import { describe, expect, it } from 'vitest';
import type { GhResult } from './github.js';
import { searchResponse } from './reviews.fixture.js';
import { parseReviewSearch, repoFromRepositoryUrl, reviewPollOutcome } from './reviews.js';

const withFields = (fields: Record<string, unknown>): unknown => ({
  ...(searchResponse as Record<string, unknown>),
  ...fields,
});
/** The fixture is a window onto 167 matches; the queue tests want a page that is all of them. */
const complete = (): unknown => withFields({ total_count: 3 });
const fixtureItems = () => (searchResponse as { items: Record<string, unknown>[] }).items;

describe('parseReviewSearch', () => {
  it('reads every field of the recorded response, newest first', () => {
    const page = parseReviewSearch(complete());
    expect(page?.complete).toBe(true);
    expect(page?.items).toHaveLength(3);
    expect(page?.items[0]).toEqual({
      key: 'phil510/garden#378',
      repo: 'phil510/garden',
      number: 378,
      title: 'Show toasts bottom-left and dismiss them after 5 seconds',
      author: 'phil510',
      url: 'https://github.com/phil510/garden/pull/378',
      draft: false,
      updatedAt: '2026-11-04T15:10:03Z',
      clonePath: null,
      sessionId: null,
    });
  });

  it('orders by updatedAt regardless of the order GitHub returned', () => {
    const reversed = withFields({ items: [...fixtureItems()].reverse() });
    expect(parseReviewSearch(reversed)?.items.map((i) => i.number)).toEqual([378, 376, 374]);
  });

  it('is complete at exactly 100 matches and incomplete at 101', () => {
    expect(parseReviewSearch(withFields({ total_count: 100 }))?.complete).toBe(true);
    expect(parseReviewSearch(withFields({ total_count: 101 }))?.complete).toBe(false);
  });

  it('is incomplete when GitHub reports incomplete results', () => {
    expect(parseReviewSearch(withFields({ incomplete_results: true }))?.complete).toBe(false);
  });

  it.each([
    ['a non-object body', 'nope'],
    ['a missing items list', withFields({ items: undefined })],
    ['a non-numeric total_count', withFields({ total_count: '3' })],
    ['an item missing draft', withFields({ items: [{ ...fixtureItems()[0], draft: undefined }] })],
    [
      'an item with a bad repository_url',
      withFields({ items: [{ ...fixtureItems()[0], repository_url: 'x' }] }),
    ],
  ])('rejects %s', (_name, body) => {
    expect(parseReviewSearch(body)).toBeNull();
  });
});

describe('repoFromRepositoryUrl', () => {
  it('normalises the repo like a watch repo', () => {
    expect(repoFromRepositoryUrl('https://api.github.com/repos/Phil510/Garden')).toBe(
      'phil510/garden',
    );
  });

  it('is null for a URL that is not a repos URL', () => {
    expect(repoFromRepositoryUrl('https://github.com/phil510/garden')).toBeNull();
  });
});

describe('reviewPollOutcome', () => {
  const ok = (body: unknown): GhResult => ({ kind: 'ok', etag: null, body });
  it.each<[string, GhResult, string | null]>([
    ['a complete response', ok(complete()), null],
    ['an incomplete response', ok(withFields({ incomplete_results: true })), 'incomplete'],
    ['more than one page of matches', ok(withFields({ total_count: 101 })), 'incomplete'],
    ['a malformed body', ok({}), 'error'],
    ['gh missing', { kind: 'unavailable', reason: 'missing' }, 'gh-missing'],
    ['gh logged out', { kind: 'unavailable', reason: 'logged-out' }, 'logged-out'],
    ['a rate limit', { kind: 'rate-limited', resumeAt: 1 }, 'rate-limited'],
    ['an inaccessible search', { kind: 'inaccessible', status: 403 }, 'error'],
    ['not-modified', { kind: 'not-modified' }, 'error'],
  ])('maps %s', (_name, result, fault) => {
    const outcome = reviewPollOutcome(result);
    if (fault === null) expect(outcome.kind).toBe('complete');
    else expect(outcome).toEqual({ kind: 'fault', fault });
  });
});
