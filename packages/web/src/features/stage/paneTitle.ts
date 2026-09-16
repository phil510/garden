import type { SessionState } from '@garden/shared';
import { lastPathSegment } from '../sidebar/lastPathSegment';

/**
 * The pane header's title line: `<project>: <title>` when the session's repo root is known,
 * bare `<title>` otherwise. `repoRoot` is repo-stable, unlike the worktree-varying `cwd`.
 */
export function paneTitle(session: SessionState): string {
  const title = session.title ?? session.cwd;
  return session.repoRoot === null ? title : `${lastPathSegment(session.repoRoot)}: ${title}`;
}
