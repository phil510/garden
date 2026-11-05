import type { ReviewQueue } from '@garden/shared';

const NOTICES: Record<NonNullable<ReviewQueue['fault']>, string> = {
  'gh-missing': "GitHub CLI (gh) isn't installed, so review requests can't be checked.",
  'logged-out': 'gh is logged out. Run `gh auth login` to see review requests.',
  'rate-limited': 'GitHub search rate limit hit. Garden will retry shortly.',
  incomplete: 'GitHub returned incomplete results. Showing the last complete list.',
  error: "Couldn't check GitHub for review requests.",
};

export function reviewFaultNotice(fault: ReviewQueue['fault']): string | null {
  return fault === null ? null : NOTICES[fault];
}
