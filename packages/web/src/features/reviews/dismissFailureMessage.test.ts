import { describe, expect, it } from 'vitest';
import { ApiError, DismissReviewError } from '../../api/client';
import { dismissFailureMessage } from './dismissFailureMessage';

describe('dismissFailureMessage', () => {
  it.each([
    [new DismissReviewError({ kind: 'error', status: 403 }), "didn't allow"],
    [new DismissReviewError({ kind: 'error', status: 422 }), "didn't allow"],
    [new DismissReviewError({ kind: 'error', status: 500 }), 'answered 500'],
    [new DismissReviewError({ kind: 'error' }), "Couldn't remove"],
    [new DismissReviewError({ kind: 'gh-missing' }), "isn't installed"],
    [new DismissReviewError({ kind: 'logged-out' }), 'gh auth login'],
    [new DismissReviewError({ kind: 'rate-limited' }), 'rate limit'],
    [new ApiError('not in the review queue', 404), 'no longer in the review queue'],
    [new ApiError('invalid repo', 400), 'invalid repo'],
    [new TypeError('Failed to fetch'), 'Something went wrong'],
  ])('maps %o to a message containing %s', (error, expected) => {
    expect(dismissFailureMessage(error)).toContain(expected);
  });
});
