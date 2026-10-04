import { describe, expect, it } from 'vitest';
import { initialWatchForm, toAddWatchRequest, type WatchForm } from './watchForm';

const form = (overrides: Partial<WatchForm>): WatchForm => ({
  ...initialWatchForm(),
  ...overrides,
});

describe('toAddWatchRequest', () => {
  it('accepts a bare PR number and omits a blank repo', () => {
    expect(toAddWatchRequest(form({ pr: '241' }))).toEqual({
      ok: true,
      body: { pr: 241, kinds: ['review', 'comment', 'checks', 'conflict', 'closed'] },
    });
  });

  it('accepts a PR number with a leading hash and surrounding space', () => {
    const result = toAddWatchRequest(form({ pr: ' #241 ' }));
    expect(result.ok && result.body.pr).toBe(241);
  });

  it.each(['', '#', 'abc', '0', '-3', '2.5', '12x'])('rejects the PR %j', (pr) => {
    expect(toAddWatchRequest(form({ pr }))).toEqual({
      ok: false,
      message: 'Enter a PR number, like 241.',
    });
  });

  it('includes a valid repo, trimmed', () => {
    const result = toAddWatchRequest(form({ pr: '1', repo: ' acme/api ' }));
    expect(result.ok && result.body.repo).toBe('acme/api');
  });

  it.each(['acme', 'acme/', '/api', 'a/b/c', 'ac me/api'])('rejects the repo %j', (repo) => {
    expect(toAddWatchRequest(form({ pr: '1', repo }))).toEqual({
      ok: false,
      message: 'Repo must look like owner/name.',
    });
  });

  it('always includes closed, even when every other kind is off', () => {
    const result = toAddWatchRequest(
      form({
        pr: '1',
        kinds: { review: false, comment: false, checks: false, conflict: false },
      }),
    );
    expect(result.ok && result.body.kinds).toEqual(['closed']);
  });

  it('sends checks:all when checks is on and set to all', () => {
    const result = toAddWatchRequest(form({ pr: '1', checksAll: true }));
    expect(result.ok && result.body.kinds).toEqual([
      'review',
      'comment',
      'checks:all',
      'conflict',
      'closed',
    ]);
  });

  it('drops checks entirely when it is off, regardless of the failures/all choice', () => {
    const result = toAddWatchRequest(
      form({
        pr: '1',
        checksAll: true,
        kinds: { review: true, comment: true, checks: false, conflict: true },
      }),
    );
    expect(result.ok && result.body.kinds).toEqual(['review', 'comment', 'conflict', 'closed']);
  });
});
