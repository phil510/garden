import { ApiError, DismissReviewError } from '../../api/client';
import { commandFailureMessage } from '../../api/reportCommandFailure';

/** The toast text for a dismiss that did not go through. */
export function dismissFailureMessage(error: unknown): string {
  if (error instanceof DismissReviewError) {
    const { kind, status } = error.failure;
    switch (kind) {
      case 'gh-missing':
        return "GitHub CLI (gh) isn't installed, so the review request couldn't be removed.";
      case 'logged-out':
        return 'gh is logged out. Run `gh auth login`, then try again.';
      case 'rate-limited':
        return 'GitHub rate limit hit. Try again shortly.';
      case 'error':
        if (status === 403 || status === 422)
          return "GitHub didn't allow removing this review request.";
        if (status !== undefined) return `GitHub answered ${String(status)} to the dismiss.`;
        return "Couldn't remove the review request.";
    }
  }
  if (error instanceof ApiError && error.status === 404)
    return 'This request is no longer in the review queue.';
  return commandFailureMessage(error);
}
