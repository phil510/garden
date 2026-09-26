import type { SessionMap, SessionPlacement, SessionState, UiState } from '@garden/shared';
import { isAttentionStatus } from './attentionStatus';

export interface SwarmTreeNode {
  sessionId: string;
  children: SwarmTreeNode[];
}

export interface SwarmGroup {
  swarmId: string;
  name: string;
  repoCount: number;
  attention: number;
  collapsed: boolean;
  hideDead: boolean;
  /** The raw record flag — unlike `finished`, doesn't also fold in "every member dead" — for
   *  the header menu's Archive/Unarchive label and dispatch. */
  archived: boolean;
  finished: boolean;
  roots: SwarmTreeNode[];
  /** Most recent member `lastActivity` (0 for a swarm with no members) — the same figure
   *  `swarmOrder`-less sort already uses internally, exposed for the "Add to swarm" menu's
   *  own recency sort over active swarms. */
  recency: number;
}

export interface GroupedSwarms {
  swarms: SwarmGroup[];
  solo: SwarmTreeNode[];
  /** Root-level Solo member count before hide-dead filtering, so the Solo section (and its
   *  hide-dead toggle) stays visible even when filtering empties the visible list — same as
   *  a swarm group's "Nothing to show" state, rather than the toggle vanishing with nothing
   *  left to un-hide. */
  soloTotal: number;
  soloHideDead: boolean;
}

type SwarmsUiState = Pick<
  UiState,
  'swarms' | 'placements' | 'swarmOrder' | 'collapsedSwarms' | 'hideDeadSwarms'
>;

/**
 * Walks `parent` up to a top-level ancestor (a placement with `swarmId` set, or a
 * placement with neither field set). Mirrors the server's already-tested
 * `resolveSwarmId`/`placementOf` walk (`packages/server/src/domain/swarms.ts`) exactly —
 * same semantics, client-side, since `placements` is already sent over `ui-state` messages.
 * Bounded by a visited `Set`, not an entry-count counter, for the same reason as the server
 * walk: an acyclic chain can legitimately read one hop past the entry count, at the final
 * missing parent.
 */
export function resolveTopLevelSwarmId(
  placements: Record<string, SessionPlacement>,
  sessionId: string,
): string | undefined {
  const visited = new Set<string>();
  let currentId: string | undefined = sessionId;
  while (currentId !== undefined) {
    if (visited.has(currentId)) return undefined;
    visited.add(currentId);
    const entry: SessionPlacement | undefined = placements[currentId];
    if (entry === undefined) return undefined;
    if (entry.swarmId !== undefined) return entry.swarmId;
    currentId = entry.parent;
  }
  return undefined;
}

export const SOLO_BUCKET_ID = 'solo';

/** Removes dead leaves bottom-up: a node survives if it has any surviving child (a live
 *  descendant of a hidden dead predecessor must still show, so the predecessor stays too —
 *  only a node that is *both* dead and childless after filtering its own children is
 *  actually a leaf worth hiding), or if it has a `successor` (AC7's handoff-trail
 *  exception), or if hide-dead is off. Applied uniformly to top-level roots and nested
 *  children alike, so a genuinely leaf-and-dead top-level member hides same as any other. */
function filterDeadLeaves(
  node: SwarmTreeNode,
  sessions: SessionMap,
  placements: Record<string, SessionPlacement>,
  hideDead: boolean,
): SwarmTreeNode | null {
  const children = node.children
    .map((child) => filterDeadLeaves(child, sessions, placements, hideDead))
    .filter((child): child is SwarmTreeNode => child !== null);
  if (!hideDead || children.length > 0) return { ...node, children };
  const session = sessions[node.sessionId];
  const hasSuccessor = placements[node.sessionId]?.successor !== undefined;
  if (session?.liveness === 'dead' && !hasSuccessor) return null;
  return { ...node, children };
}

/**
 * Groups sessions into their swarm (resolved by walking `parent` to a top-level ancestor)
 * plus a Solo bucket for everyone else, each rendered as a forest of trees. A session
 * resolving to a `swarmId` with no matching entry in `uiState.swarms` — deleted, or a
 * desync between the overlay and the live session set — falls back to Solo rather than
 * vanishing from the sidebar.
 */
export function groupSwarms(sessions: SessionMap, uiState: SwarmsUiState): GroupedSwarms {
  const knownSwarms = new Map(uiState.swarms.map((swarm) => [swarm.id, swarm]));
  const allSessions = Object.values(sessions);
  const knownSessionIds = new Set(allSessions.map((session) => session.id));

  const bucketOf = new Map<string, string>();
  for (const session of allSessions) {
    const resolved = resolveTopLevelSwarmId(uiState.placements, session.id);
    bucketOf.set(
      session.id,
      resolved !== undefined && knownSwarms.has(resolved) ? resolved : SOLO_BUCKET_ID,
    );
  }

  // A session's visual parent is its raw `parent` pointer, but only when that id names a
  // session actually present in the live session map — otherwise there is no row to nest
  // it under (a pruned, or not-yet-known, ancestor; see docs/architecture.md §1 on
  // cross-source desync), so it becomes a top-level node in its own bucket instead.
  const childrenByParent = new Map<string, string[]>();
  const rootIdsByBucket = new Map<string, string[]>();
  for (const session of allSessions) {
    const parent = uiState.placements[session.id]?.parent;
    const visualParent = parent !== undefined && knownSessionIds.has(parent) ? parent : undefined;
    if (visualParent === undefined) {
      const bucket = bucketOf.get(session.id) ?? SOLO_BUCKET_ID;
      const roots = rootIdsByBucket.get(bucket);
      if (roots === undefined) rootIdsByBucket.set(bucket, [session.id]);
      else roots.push(session.id);
      continue;
    }
    const siblings = childrenByParent.get(visualParent);
    if (siblings === undefined) childrenByParent.set(visualParent, [session.id]);
    else siblings.push(session.id);
  }

  // `visualParent` is restricted to live sessions the same way `resolveTopLevelSwarmId`
  // restricts its walk to known placements, but normal writes can't create a cycle here
  // either (the server's `wouldCreateParentCycle` rejects one before it's ever written) —
  // guarded anyway, matching that walk's own guard, since a hand-edited state.json is the
  // same credible risk `pruneOverlay` already treats it as server-side. Without this, a
  // cyclic `parent` chain would recurse forever rather than just resolving oddly.
  function buildNode(sessionId: string, visited: ReadonlySet<string> = new Set()): SwarmTreeNode {
    if (visited.has(sessionId)) return { sessionId, children: [] };
    const nextVisited = new Set(visited).add(sessionId);
    const childIds = childrenByParent.get(sessionId) ?? [];
    const children = childIds
      .map((id) => sessions[id])
      .filter((s): s is SessionState => s !== undefined)
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .map((s) => buildNode(s.id, nextVisited));
    return { sessionId, children };
  }

  function sortedRoots(bucket: string): SessionState[] {
    return (rootIdsByBucket.get(bucket) ?? [])
      .map((id) => sessions[id])
      .filter((s): s is SessionState => s !== undefined)
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }

  const collapsedSwarms = new Set(uiState.collapsedSwarms);
  const hideDeadSwarms = new Set(uiState.hideDeadSwarms);
  const order = new Map(uiState.swarmOrder.map((id, index) => [id, index]));

  const swarms: SwarmGroup[] = Array.from(knownSwarms.values(), (swarm) => {
    const memberIds = allSessions.filter((session) => bucketOf.get(session.id) === swarm.id);
    const repoCount = new Set(
      memberIds.map((session) => session.repoRoot).filter((root): root is string => root !== null),
    ).size;
    const attention = memberIds.filter((session) => isAttentionStatus(session.status)).length;
    const finished =
      swarm.archived || (memberIds.length > 0 && memberIds.every((s) => s.liveness === 'dead'));
    const hideDead = hideDeadSwarms.has(swarm.id);
    const recency = Math.max(0, ...memberIds.map((s) => s.lastActivity));

    return {
      swarmId: swarm.id,
      name: swarm.name,
      repoCount,
      attention,
      // Membership marks a swarm as expanded; a swarm absent from the list (the default)
      // is collapsed — mirrors groupSessions.ts's collapsedRepos/collapsed inversion, kept
      // for consistency with the sibling Repos-mode toggle rather than fixed here.
      collapsed: !collapsedSwarms.has(swarm.id),
      hideDead,
      archived: swarm.archived,
      finished,
      recency,
      roots: sortedRoots(swarm.id)
        .map((session) => buildNode(session.id))
        .map((node) => filterDeadLeaves(node, sessions, uiState.placements, hideDead))
        .filter((node): node is SwarmTreeNode => node !== null),
    };
  });

  swarms.sort((a, b) => {
    const aOrder = order.get(a.swarmId);
    const bOrder = order.get(b.swarmId);
    // Unlike groupSessions.ts's pinned/unpinned split, every swarm is equally subject to
    // swarmOrder, so both sides falling back to the same sentinel (neither ordered) has to
    // be guarded explicitly here — Infinity minus Infinity is NaN, an invalid comparator
    // result groupSessions.ts never hits because its `pinned &&` guard skips orderDelta
    // entirely for two unpinned groups.
    if (aOrder !== undefined || bOrder !== undefined) {
      const orderDelta =
        (aOrder ?? Number.POSITIVE_INFINITY) - (bOrder ?? Number.POSITIVE_INFINITY);
      if (orderDelta !== 0) return orderDelta;
    }
    return b.recency - a.recency;
  });

  const soloRoots = sortedRoots(SOLO_BUCKET_ID).map((session) => buildNode(session.id));
  const soloHideDead = hideDeadSwarms.has(SOLO_BUCKET_ID);
  const solo = soloRoots
    .map((node) => filterDeadLeaves(node, sessions, uiState.placements, soloHideDead))
    .filter((node): node is SwarmTreeNode => node !== null);

  return { swarms, solo, soloTotal: soloRoots.length, soloHideDead };
}

export interface ActiveSwarmOption {
  swarmId: string;
  name: string;
}

/** Active (not finished/archived) swarms, most-recent-activity first — feeds the "Add to
 *  swarm" row menu's own sort, which is recency-only and therefore distinct from the
 *  sidebar's own swarmOrder-then-recency order (`groupSwarms`'s `swarms.sort` above). Reuses
 *  each `SwarmGroup`'s already-computed `recency` rather than re-deriving it. */
export function activeSwarmsByRecency(swarms: readonly SwarmGroup[]): ActiveSwarmOption[] {
  return swarms
    .filter((swarm) => !swarm.finished)
    .slice()
    .sort((a, b) => b.recency - a.recency)
    .map((swarm) => ({ swarmId: swarm.swarmId, name: swarm.name }));
}
