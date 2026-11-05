import { aReviewItem, aReviewQueue } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { reviewCount, reviewToastMessage } from './reviewToast';

const a = aReviewItem({ key: 'acme/widgets#1', number: 1, title: 'First' });
const b = aReviewItem({ key: 'acme/widgets#2', number: 2, title: 'Second' });
const c = aReviewItem({ key: 'acme/gadgets#3', repo: 'acme/gadgets', number: 3, title: 'Third' });

describe('reviewToastMessage', () => {
  it('stays silent with no previous queue', () => {
    expect(reviewToastMessage(null, aReviewQueue({ items: [a] }))).toBeNull();
  });

  it('stays silent on the first poll after a server restart, though every key is new', () => {
    const prev = aReviewQueue({ polledAt: null });
    expect(reviewToastMessage(prev, aReviewQueue({ items: [a, b] }))).toBeNull();
  });

  it('names a single new request', () => {
    const msg = reviewToastMessage(aReviewQueue({ items: [a] }), aReviewQueue({ items: [c, a] }));
    expect(msg).toBe('Review requested: acme/gadgets#3 — Third');
  });

  it('counts several new requests in one message', () => {
    const msg = reviewToastMessage(aReviewQueue(), aReviewQueue({ items: [a, b, c] }));
    expect(msg).toBe('3 new review requests');
  });

  it('stays silent when items were only removed or kept', () => {
    const prev = aReviewQueue({ items: [a, b] });
    expect(reviewToastMessage(prev, aReviewQueue({ items: [a] }))).toBeNull();
    expect(reviewToastMessage(prev, aReviewQueue({ items: [a, b] }))).toBeNull();
  });

  it('stays silent when a faulted poll repeats the stale items', () => {
    const prev = aReviewQueue({ items: [a] });
    const next = aReviewQueue({ items: [a], fault: 'logged-out' });
    expect(reviewToastMessage(prev, next)).toBeNull();
  });
});

describe('reviewCount', () => {
  it('is zero without a queue', () => {
    expect(reviewCount(null)).toBe(0);
  });

  it('counts items that already have a session linked', () => {
    const linked = aReviewItem({ key: 'acme/widgets#9', sessionId: 'abc' });
    expect(reviewCount(aReviewQueue({ items: [a, b, linked] }))).toBe(3);
  });
});
