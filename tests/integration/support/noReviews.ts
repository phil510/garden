import { createReviewStore } from '../../../packages/server/src/app/reviews.js';

/** For servers under test that never poll for reviews: an empty queue that never changes. */
export const noReviews = createReviewStore();
