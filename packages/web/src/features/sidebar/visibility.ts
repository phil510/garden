import type { SessionState } from '@garden/shared';
import type { SwarmTreeNode } from './groupSwarms';

const OLD_DEAD_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

export interface VisibilityState {
  hideDead: boolean;
  showOlder: boolean;
}

function isOldDead(session: SessionState, now: number): boolean {
  return session.liveness === 'dead' && now - session.lastActivity > OLD_DEAD_THRESHOLD_MS;
}

/**
 * A dead session is visible by default only within the 14-day window; `hideDead` hides every
 * dead session regardless of age, and `showOlder` reveals the older ones the window would
 * otherwise hold back. Live sessions are always visible.
 */
export function visibleSessions(
  sessions: readonly SessionState[],
  { hideDead, showOlder }: VisibilityState,
  now: number,
): SessionState[] {
  return sessions.filter((session) => {
    if (session.liveness !== 'dead') return true;
    if (hideDead) return false;
    if (isOldDead(session, now) && !showOlder) return false;
    return true;
  });
}

export function hiddenOldDeadCount(
  sessions: readonly SessionState[],
  hideDead: boolean,
  now: number,
): number {
  if (hideDead) return 0;
  return sessions.filter((session) => isOldDead(session, now)).length;
}

/**
 * Walks the forest in display order (a node before its children), counting every dead node at any
 * depth toward `cap`. A dead node past the cap is hidden unless a descendant survives, in which
 * case it stays as that descendant's ancestor; live nodes are never counted or dropped.
 */
export function capDeadForest(
  nodes: readonly SwarmTreeNode[],
  isDead: (sessionId: string) => boolean,
  cap: number,
): { nodes: SwarmTreeNode[]; hiddenDeadCount: number } {
  let deadSeen = 0;
  let hiddenDeadCount = 0;

  function visit(node: SwarmTreeNode): SwarmTreeNode | null {
    const dead = isDead(node.sessionId);
    if (dead) deadSeen += 1;
    const overCap = dead && deadSeen > cap;
    const children = node.children.flatMap((child) => visit(child) ?? []);
    if (overCap && children.length === 0) {
      hiddenDeadCount += 1;
      return null;
    }
    return { ...node, children };
  }

  return { nodes: nodes.flatMap((node) => visit(node) ?? []), hiddenDeadCount };
}

/** The flat form of `capDeadForest`: each session is a leaf, so the first `cap` dead ones stay. */
export function capDeadSessions(
  sessions: readonly SessionState[],
  cap: number,
): { sessions: SessionState[]; hiddenDeadCount: number } {
  const deadIds = new Set(sessions.filter((s) => s.liveness === 'dead').map((s) => s.id));
  const capped = capDeadForest(
    sessions.map((session) => ({ sessionId: session.id, children: [] })),
    (id) => deadIds.has(id),
    cap,
  );
  const kept = new Set(capped.nodes.map((node) => node.sessionId));
  return {
    sessions: sessions.filter((session) => kept.has(session.id)),
    hiddenDeadCount: capped.hiddenDeadCount,
  };
}
