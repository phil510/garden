import type { ReviewQueue } from '@garden/shared';
import { useReviewStore } from '../../state/reviewStore';
import { useToastStore } from '../../state/toastStore';
import { reviewToastMessage } from './reviewToast';

/** Applies a `reviews` message. The previous queue is read before it is replaced, so the toast
 *  compares against what the user was looking at. A snapshot never goes through here: it sets
 *  the store directly, which resets the baseline without toasting. */
export function receiveReviews(queue: ReviewQueue): void {
  const message = reviewToastMessage(useReviewStore.getState().queue, queue);
  useReviewStore.getState().setQueue(queue);
  if (message !== null) useToastStore.getState().showToast(message, 'success');
}
