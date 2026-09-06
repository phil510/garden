import type { SessionMap, SessionState, UiState } from '@garden/shared';
import { lastPathSegment } from './lastPathSegment';

export interface SidebarGroup {
  repoRoot: string;
  repoName: string;
  sessionIds: string[];
  liveCount: number;
  attention: boolean;
  pinned: boolean;
  collapsed: boolean;
}

/**
 * Client-side mirror of the server's `domain/groups.ts`: the layering forbids importing it
 * directly, so the same folding and ordering rules are reproduced here over the session map
 * the client already has. Pinned groups sort first in the user's drag order, then unpinned
 * groups by most recent activity. A session with no known repo root belongs to no group.
 */
export function groupSessions(
  sessions: SessionMap,
  uiState: Pick<UiState, 'groupOrder' | 'pinnedRepos' | 'collapsedRepos'>,
): SidebarGroup[] {
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

  const groups: SidebarGroup[] = Array.from(byRoot.entries(), ([repoRoot, members]) => ({
    repoRoot,
    repoName: lastPathSegment(repoRoot),
    sessionIds: [...members]
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .map((session) => session.id),
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
