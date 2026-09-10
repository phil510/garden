import type { SessionState } from '@garden/shared';
import { lastPathSegment } from '../sidebar/lastPathSegment';

/** The subheader's worktree line, or null when the session isn't in one. `repoRoot` resolves
 *  to the repo's own checkout for a worktree session too (see server `repos.ts`), so a `cwd`
 *  equal to `repoRoot` means the session is checked out at the repo root itself. The two are
 *  compared as plain strings — a root reached through a symlinked ancestor could in principle
 *  report a differently-spelled `cwd` for the same tree, which would misread as a worktree. */
export function paneWorktreeLabel(session: Pick<SessionState, 'cwd' | 'repoRoot'>): string | null {
  if (session.repoRoot === null || session.cwd === session.repoRoot) return null;
  return lastPathSegment(session.cwd);
}
