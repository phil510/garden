import type { SessionPlacement, SessionState, SwarmRecord } from '@garden/shared';
import { lastPathSegment } from '../sidebar/lastPathSegment';
import { resolveTopLevelSwarmId } from '../sidebar/groupSwarms';

/**
 * The pane header's title line: `<project>: <title>` when the session's repo root is known,
 * bare `<title>` otherwise. `repoRoot` is repo-stable, unlike the worktree-varying `cwd`.
 */
export function paneTitle(session: SessionState): string {
  const title = session.title ?? session.cwd;
  return session.repoRoot === null ? title : `${lastPathSegment(session.repoRoot)}: ${title}`;
}

export interface SwarmChip {
  id: string;
  name: string;
}

/**
 * The swarm breadcrumb chip for a session's pane header, or null for a solo session (or one
 * whose resolved swarm id no longer has a matching `SwarmRecord` — a delete/placement race).
 */
export function swarmChipFor(
  session: SessionState,
  placements: Record<string, SessionPlacement>,
  swarms: SwarmRecord[],
): SwarmChip | null {
  const swarmId = resolveTopLevelSwarmId(placements, session.id);
  if (swarmId === undefined) return null;
  const swarm = swarms.find((candidate) => candidate.id === swarmId);
  return swarm === undefined ? null : { id: swarm.id, name: swarm.name };
}
