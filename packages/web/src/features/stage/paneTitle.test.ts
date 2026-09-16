import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { paneTitle } from './paneTitle';

describe('paneTitle', () => {
  it('prefixes the title with the repo root folder name when the repo root is known', () => {
    const session = aSession({ repoRoot: '/Users/dev/garden', title: 'Fix the bug' });
    expect(paneTitle(session)).toBe('garden: Fix the bug');
  });

  it('falls back to the cwd when the session has no title yet', () => {
    const session = aSession({
      repoRoot: '/Users/dev/garden',
      title: null,
      cwd: '/Users/dev/garden',
    });
    expect(paneTitle(session)).toBe('garden: /Users/dev/garden');
  });

  it('omits the project prefix entirely when the repo root is unknown', () => {
    const session = aSession({ repoRoot: null, title: 'Fix the bug' });
    expect(paneTitle(session)).toBe('Fix the bug');
  });
});
