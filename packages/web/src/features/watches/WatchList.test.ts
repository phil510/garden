import type { WatchSummary } from '@garden/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WatchList } from './WatchList';

const watch: WatchSummary = {
  repo: 'acme/api',
  pr: 7,
  kinds: ['review'],
  pendingDigest: false,
  ignoredChecks: [],
  status: 'active',
};

describe('WatchList PR number', () => {
  it('is plain text without an open handler, as in the hover card', () => {
    const html = renderToStaticMarkup(createElement(WatchList, { watches: [watch] }));
    expect(html).toContain('<span class="wl-pr">#7</span>');
    expect(html).not.toContain('<button');
  });

  it('is a keyboard-reachable button when an open handler is given', () => {
    const html = renderToStaticMarkup(
      createElement(WatchList, { watches: [watch], onOpenPr: () => undefined }),
    );
    expect(html).toMatch(/<button[^>]*class="wl-pr wl-pr-link"[^>]*>#7<\/button>/);
  });
});
