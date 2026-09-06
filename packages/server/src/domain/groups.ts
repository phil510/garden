import type { SessionMap, SessionState, UiState } from '@garden/shared';

export interface SessionGroup {
  repoRoot: string;
  sessionIds: string[];
  liveCount: number;
  attention: boolean;
  pinned: boolean;
  collapsed: boolean;
}

/**
 * Folds sessions into their repo, orders pinned groups by the user's drag order
 * (`groupOrder`) first and unpinned groups by most recent activity, and reports the per-group
 * facts the sidebar header needs. A session with no known repo root belongs to no group yet.
 */
export function buildGroups(
  sessions: SessionMap,
  uiState: Pick<UiState, 'groupOrder' | 'pinnedRepos' | 'collapsedRepos'>,
): SessionGroup[] {
  const byRoot = new Map<string, SessionState[]>();
  for (const session of Object.values(sessions)) {
    if (session.repoRoot === null) continue;
    const members = byRoot.get(session.repoRoot);
    if (members === undefined) byRoot.set(session.repoRoot, [session]);
    else members.push(session);
  }

  const pinned = new Set(uiState.pinnedRepos);
  const collapsed = new Set(uiState.collapsedRepos);
  const order = new Map(uiState.groupOrder.map((repoRoot, index) => [repoRoot, index]));

  const mostRecentActivity = new Map(
    Array.from(byRoot.entries(), ([repoRoot, members]) => [
      repoRoot,
      Math.max(...members.map((session) => session.lastActivity)),
    ]),
  );

  const groups: SessionGroup[] = Array.from(byRoot.entries(), ([repoRoot, members]) => ({
    repoRoot,
    sessionIds: members.map((session) => session.id),
    liveCount: members.filter((session) => session.liveness === 'live').length,
    attention: members.some(
      (session) => session.status === 'needs-approval' || session.status === 'waiting',
    ),
    pinned: pinned.has(repoRoot),
    collapsed: collapsed.has(repoRoot),
  }));

  groups.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const orderDelta =
      (order.get(a.repoRoot) ?? Number.POSITIVE_INFINITY) -
      (order.get(b.repoRoot) ?? Number.POSITIVE_INFINITY);
    if (a.pinned && orderDelta !== 0) return orderDelta;
    return (mostRecentActivity.get(b.repoRoot) ?? 0) - (mostRecentActivity.get(a.repoRoot) ?? 0);
  });

  return groups;
}
