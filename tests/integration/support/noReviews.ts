import { createReviewStore } from '../../../packages/server/src/app/reviews.js';
import type { ReviewDismisser } from '../../../packages/server/src/app/reviewDismiss.js';
import { memoryOverlay } from '../../../packages/server/src/app/reviews.fixture.js';

/** For servers under test that never poll for reviews: an empty queue that never changes. */
export const noReviews = createReviewStore({ overlay: memoryOverlay() });

/** Dismisses nothing: the queue is always empty, so every pull request is not found. */
export const noReviewDismisser: ReviewDismisser = {
  dismiss: () => Promise.resolve({ kind: 'not-found' }),
};
