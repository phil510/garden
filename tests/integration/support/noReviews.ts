import { createReviewStore } from '../../../packages/server/src/app/reviews.js';
import { memoryOverlay } from '../../../packages/server/src/app/reviews.fixture.js';

/** For servers under test that never poll for reviews: an empty queue that never changes. */
export const noReviews = createReviewStore({ overlay: memoryOverlay() });
