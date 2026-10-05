import { describe, expect, it } from 'vitest';
import {
  parseCheckRuns,
  parseGhInclude,
  parseIssueComments,
  parsePr,
  parseReviewComments,
  parseReviews,
  parseStatuses,
  rateLimitResumeAt,
} from './github.js';
import type { GhResponse } from './github.js';

describe('parseGhInclude', () => {
  it('splits a 200 into status, lower-cased headers and body', () => {
    const out = 'HTTP/2.0 200 OK\r\nEtag: W/"abc"\r\nX-Ratelimit-Remaining: 59\r\n\r\n{"a":1}';

    expect(parseGhInclude(out)).toEqual({
      status: 200,
      headers: { etag: 'W/"abc"', 'x-ratelimit-remaining': '59' },
      body: '{"a":1}',
    });
  });

  it('reads a 304, which has no body, with LF line endings', () => {
    const out = 'HTTP/2.0 304 Not Modified\nEtag: "x"\n\n';

    expect(parseGhInclude(out)).toMatchObject({ status: 304, headers: { etag: '"x"' }, body: '' });
  });

  it('reads a 304 with no trailing blank line', () => {
    expect(parseGhInclude('HTTP/2.0 304 Not Modified\r\nEtag: "x"')).toMatchObject({ status: 304 });
  });

  it('returns null for output that is not a response', () => {
    expect(parseGhInclude('gh: command not found')).toBeNull();
  });
});

describe('rateLimitResumeAt', () => {
  const response = (status: number, headers: Record<string, string>, body = ''): GhResponse => ({
    status,
    headers,
    body,
  });

  it('waits until the reset time for an exhausted primary limit', () => {
    const r = response(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' });

    expect(rateLimitResumeAt(r, 0)).toBe(2_000_000);
  });

  it('honours Retry-After for a secondary limit', () => {
    expect(rateLimitResumeAt(response(429, { 'retry-after': '30' }), 1000)).toBe(31_000);
  });

  it('waits a minute when the body names a secondary limit without Retry-After', () => {
    const r = response(403, {}, '{"message":"You have exceeded a secondary rate limit."}');

    expect(rateLimitResumeAt(r, 1000)).toBe(61_000);
  });

  it('is null for a plain 403, a 404 and a success', () => {
    expect(rateLimitResumeAt(response(403, { 'x-ratelimit-remaining': '12' }), 0)).toBeNull();
    expect(rateLimitResumeAt(response(404, {}), 0)).toBeNull();
    expect(rateLimitResumeAt(response(200, { 'x-ratelimit-remaining': '0' }), 0)).toBeNull();
  });
});

describe('fact parsers', () => {
  it('parses a PR and ignores its content', () => {
    const pr = parsePr({
      state: 'open',
      title: 'secret',
      merged: false,
      mergeable: null,
      head: { sha: 'abc' },
    });

    expect(pr).toEqual({ open: true, merged: false, mergeable: null, headSha: 'abc' });
  });

  it('treats a closed PR with merged_at as merged', () => {
    const pr = parsePr({
      state: 'closed',
      merged_at: '2026-01-01T00:00:00Z',
      mergeable: false,
      head: { sha: 'abc' },
    });

    expect(pr).toMatchObject({ open: false, merged: true, mergeable: false });
  });

  it('returns null for a PR without a head sha', () => {
    expect(parsePr({ state: 'open' })).toBeNull();
  });

  it('skips pending reviews and malformed items, keeping the raw page count', () => {
    const page = parseReviews([
      {
        id: 1,
        user: { login: 'a' },
        body: 'x',
        submitted_at: '2026-01-01T00:00:00Z',
        state: 'COMMENTED',
      },
      { id: 2, user: { login: 'b' }, body: '', state: 'PENDING' },
      {
        id: 3,
        user: { login: 'c' },
        body: '  ',
        submitted_at: '2026-01-02T00:00:00Z',
        state: 'APPROVED',
      },
      {
        id: 4,
        user: { login: 'd' },
        body: '',
        submitted_at: '2026-01-03T00:00:00Z',
        state: 'COMMENTED',
      },
      {
        id: 5,
        user: { login: 'e' },
        body: '',
        submitted_at: '2026-01-04T00:00:00Z',
        state: 'CHANGES_REQUESTED',
      },
      'junk',
    ]);

    expect(page.count).toBe(6);
    expect(page.items).toEqual([
      {
        id: 1,
        login: 'a',
        submittedAt: Date.parse('2026-01-01T00:00:00Z'),
        state: 'COMMENTED',
        wrapper: false,
      },
      {
        id: 3,
        login: 'c',
        submittedAt: Date.parse('2026-01-02T00:00:00Z'),
        state: 'APPROVED',
        wrapper: false,
      },
      {
        id: 4,
        login: 'd',
        submittedAt: Date.parse('2026-01-03T00:00:00Z'),
        state: 'COMMENTED',
        wrapper: true,
      },
      {
        id: 5,
        login: 'e',
        submittedAt: Date.parse('2026-01-04T00:00:00Z'),
        state: 'CHANGES_REQUESTED',
        wrapper: false,
      },
    ]);
  });

  it('parses issue and review comments, keeping the review id only for inline ones', () => {
    const raw = [
      {
        id: 5,
        user: { login: 'a' },
        created_at: '2026-01-01T00:00:00Z',
        pull_request_review_id: 9,
      },
    ];

    expect(parseIssueComments(raw).items[0]).toMatchObject({ id: 5, reviewId: null });
    expect(parseReviewComments(raw).items[0]).toMatchObject({ id: 5, reviewId: 9 });
  });

  it('parses check runs, with no completion time until completed', () => {
    const page = parseCheckRuns({
      check_runs: [
        { id: 1, name: 'build', status: 'in_progress', conclusion: null, completed_at: null },
        {
          id: 2,
          name: 'lint',
          status: 'completed',
          conclusion: 'failure',
          completed_at: '2026-01-01T00:00:00Z',
        },
      ],
    });

    expect(page.items).toEqual([
      { id: 1, name: 'build', conclusion: null, completedAt: null },
      {
        id: 2,
        name: 'lint',
        conclusion: 'failure',
        completedAt: Date.parse('2026-01-01T00:00:00Z'),
      },
    ]);
  });

  it('parses combined-status contexts', () => {
    const page = parseStatuses({
      state: 'failure',
      statuses: [{ context: 'ci/x', state: 'error', updated_at: '2026-01-01T00:00:00Z' }],
    });

    expect(page.items).toEqual([
      { context: 'ci/x', state: 'error', updatedAt: Date.parse('2026-01-01T00:00:00Z') },
    ]);
  });
});
