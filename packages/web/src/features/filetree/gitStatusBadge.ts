export interface GitStatusBadge {
  readonly letter: 'M' | 'A' | 'U';
  readonly className: string;
}

/**
 * Collapses a `git status --porcelain` two-character code onto a three-badge
 * vocabulary. Untracked is its own case; a staged or unstaged addition, rename or copy
 * reads as "added"; anything else that touched the path (modified or deleted) reads as
 * "modified". Ignored paths and merge conflicts carry no badge.
 */
export function gitStatusBadge(code: string | null): GitStatusBadge | null {
  if (code === null || code === '!!') return null;
  if (code === '??') return { letter: 'U', className: 'gstat gU' };
  if (/[ARC]/.test(code)) return { letter: 'A', className: 'gstat gA' };
  if (/[MD]/.test(code)) return { letter: 'M', className: 'gstat gM' };
  return null;
}
