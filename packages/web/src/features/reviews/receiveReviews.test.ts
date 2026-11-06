import { aReviewItem, aReviewQueue } from '@garden/shared/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';
import { useReviewStore } from '../../state/reviewStore';
import { useToastStore } from '../../state/toastStore';
import { receiveReviews } from './receiveReviews';

const fresh = aReviewItem({ key: 'acme/widgets#7', number: 7, title: 'Fresh' });

beforeEach(() => {
  useReviewStore.setState({ queue: null });
  useToastStore.setState({ message: null, token: 0 });
});

describe('receiveReviews', () => {
  it('toasts a new item when the baseline was a completed poll', () => {
    useReviewStore.setState({ queue: aReviewQueue() });
    receiveReviews(aReviewQueue({ items: [fresh] }));
    expect(useToastStore.getState().message).toBe('Review requested: acme/widgets#7 — Fresh');
  });

  it('does not toast when the baseline snapshot had never been polled', () => {
    useReviewStore.setState({ queue: aReviewQueue({ polledAt: null }) });
    receiveReviews(aReviewQueue({ items: [fresh] }));
    expect(useToastStore.getState().message).toBeNull();
  });

  it('does not toast before any snapshot arrived', () => {
    receiveReviews(aReviewQueue({ items: [fresh] }));
    expect(useToastStore.getState().message).toBeNull();
  });

  it('compares against the previous queue, so the same items do not toast twice', () => {
    useReviewStore.setState({ queue: aReviewQueue() });
    receiveReviews(aReviewQueue({ items: [fresh] }));
    useToastStore.getState().clearToast();
    receiveReviews(aReviewQueue({ items: [fresh] }));
    expect(useToastStore.getState().message).toBeNull();
  });
});
