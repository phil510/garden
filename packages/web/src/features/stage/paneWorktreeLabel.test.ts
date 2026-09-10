import { aSession } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { paneWorktreeLabel } from './paneWorktreeLabel';

describe('paneWorktreeLabel', () => {
  it('names the worktree when cwd sits beside the repo root', () => {
    const session = aSession({
      repoRoot: '/Users/dev/repo',
      cwd: '/Users/dev/repo/.worktrees/feat/x',
    });
    expect(paneWorktreeLabel(session)).toBe('x');
  });

  it('omits the worktree when the session runs at the repo root itself', () => {
    const session = aSession({ repoRoot: '/Users/dev/repo', cwd: '/Users/dev/repo' });
    expect(paneWorktreeLabel(session)).toBeNull();
  });

  it('omits the worktree when the repo root is unresolved', () => {
    const session = aSession({ repoRoot: null, cwd: '/Users/dev/repo/.worktrees/feat/x' });
    expect(paneWorktreeLabel(session)).toBeNull();
  });
});
