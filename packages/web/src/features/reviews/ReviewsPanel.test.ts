import { aReviewItem, aReviewQueue } from '@garden/shared/fixtures';
import type { ReviewQueue } from '@garden/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { reviewFaultNotice } from './reviewFaultNotice';
import { ReviewRow, ReviewsCountBadge, ReviewsPanelView } from './ReviewsPanel';

const now = Date.parse('2026-11-04T13:00:00Z');
const item = aReviewItem({ title: 'Tidy the parser' });

const renderPanel = (queue: ReviewQueue | null) =>
  renderToStaticMarkup(createElement(ReviewsPanelView, { queue, now }));

const faults = ['gh-missing', 'logged-out', 'rate-limited', 'incomplete', 'error'] as const;

describe('ReviewsPanelView', () => {
  it.each(faults)('shows the %s fault notice', (fault) => {
    const html = renderPanel(aReviewQueue({ fault }));
    const notice = reviewFaultNotice(fault);
    expect(notice).not.toBeNull();
    expect(html).toContain(
      notice!.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;'),
    );
  });

  it('gives every fault its own notice', () => {
    expect(new Set(faults.map(reviewFaultNotice)).size).toBe(faults.length);
  });

  it('does not read a logged-out empty queue as empty', () => {
    const html = renderPanel(aReviewQueue({ fault: 'logged-out' }));
    expect(html).toContain('gh auth login');
    expect(html).not.toContain('No review requests');
  });

  it('keeps the last good items under the fault banner', () => {
    const html = renderPanel(aReviewQueue({ fault: 'incomplete', items: [item] }));
    expect(html).toContain('incomplete results');
    expect(html).toContain('Tidy the parser');
  });

  it('says it is checking, not empty, before the first poll', () => {
    for (const queue of [null, aReviewQueue({ polledAt: null })]) {
      const html = renderPanel(queue);
      expect(html).toContain('Checking GitHub');
      expect(html).not.toContain('No review requests');
    }
  });

  it('shows the empty state after a clean poll with nothing in it', () => {
    expect(renderPanel(aReviewQueue())).toContain('No review requests');
  });
});

describe('ReviewRow', () => {
  const render = (overrides: Parameters<typeof aReviewItem>[0]) =>
    renderToStaticMarkup(createElement(ReviewRow, { item: aReviewItem(overrides), now }));

  it('shows the draft marker only for drafts', () => {
    expect(render({ draft: true })).toContain('Draft');
    expect(render({ draft: false })).not.toContain('Draft');
  });

  it('shows reference, author and age', () => {
    const html = render({ updatedAt: '2026-11-04T12:00:00Z' });
    expect(html).toContain('acme/widgets#1');
    expect(html).toContain('octocat · 1h ago');
  });
});

describe('ReviewsCountBadge', () => {
  it('renders nothing at zero', () => {
    expect(renderToStaticMarkup(createElement(ReviewsCountBadge, { count: 0 }))).toBe('');
  });

  it('renders the count', () => {
    expect(renderToStaticMarkup(createElement(ReviewsCountBadge, { count: 4 }))).toContain('>4<');
  });
});
