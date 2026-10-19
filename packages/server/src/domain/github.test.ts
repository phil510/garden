import { describe, expect, it } from 'vitest';
import {
  parseCheckRuns,
  parseIssueComments,
  parsePr,
  parseReviewComments,
  parseReviews,
  parseStatuses,
} from './github.js';

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
