import type { Placement, SessionPlacement } from '@garden/shared';
import type { OverlayState } from './overlay.js';

type Placements = Readonly<Record<string, SessionPlacement>>;

export type DomainResult = { ok: true } | { ok: false; reason: string };

/** `code` is what `app/swarms.ts` switches on to pick a typed error — `reason` is the
 *  human-readable detail carried onto that error's message, not a second source of truth
 *  for the app layer to pattern-match against. */
export type HandoffRejectionCode = 'existing-successor' | 'cross-swarm' | 'cycle';

export type HandoffResult =
  | { ok: true; placements: Record<string, SessionPlacement> }
  | { ok: false; code: HandoffRejectionCode; reason: string };

/**
 * Walks `parent` up to a top-level ancestor (a placement with `swarmId` set, or a
 * placement with neither field set). A `parent` id with no `placements` entry at all —
 * dangling, not a cycle, and also the everyday case for a session nobody has placed yet —
 * ends the walk as solo, same as a session with no entry of its own. Bounded by a visited
 * `Set` rather than an entry-count counter: an acyclic chain can legitimately read one more
 * hop than there are entries, at the final missing parent.
 */
export function resolveSwarmId(placements: Placements, sessionId: string): string | undefined {
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

/**
 * True if reassigning `sessionId`'s parent to `newParentId` would create a parent cycle:
 * `newParentId` is `sessionId` itself, or `newParentId` is already a descendant of
 * `sessionId` (equivalently, walking `newParentId`'s own ancestor chain reaches
 * `sessionId`). Sufficient for a single parent reassignment, since the new edge is the
 * only one that changed and it can't lie on its own cycle — the walk always ends at
 * `sessionId`.
 */
export function wouldCreateParentCycle(
  placements: Placements,
  sessionId: string,
  newParentId: string,
): boolean {
  const visited = new Set<string>();
  let currentId: string | undefined = newParentId;
  while (currentId !== undefined) {
    if (currentId === sessionId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    currentId = placements[currentId]?.parent;
  }
  return false;
}

/**
 * True if `sessionId` appears in `newSuccessorId`'s successor chain — walking the whole
 * chain, not just the immediate hop, matters: a 3-hop chain (A's successor is B, whose
 * successor would become A) is only caught this way.
 */
export function wouldCreateSuccessorCycle(
  placements: Placements,
  sessionId: string,
  newSuccessorId: string,
): boolean {
  const visited = new Set<string>();
  let currentId: string | undefined = newSuccessorId;
  while (currentId !== undefined) {
    if (currentId === sessionId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    currentId = placements[currentId]?.successor;
  }
  return false;
}

/**
 * Checks a proposed placement against the overlay's current swarms/placements. The target
 * session existing (for a `parent` placement) is the caller's job — `app/swarms.ts` checks
 * it against the known-session set before this ever runs, so a dangling reference is never
 * writable in the first place. This only checks what the domain alone can decide: does the
 * named swarm exist, and does a `parent` target create a cycle.
 */
export function validatePlacement(
  overlay: OverlayState,
  sessionId: string,
  placement: Placement,
): DomainResult {
  if (placement.type === 'swarm') {
    if (!overlay.swarms.some((swarm) => swarm.id === placement.swarmId))
      return { ok: false, reason: `no such swarm: ${placement.swarmId}` };
    return { ok: true };
  }
  if (placement.type === 'parent') {
    if (wouldCreateParentCycle(overlay.placements, sessionId, placement.parentId))
      return {
        ok: false,
        reason: `would create a cycle: ${placement.parentId} is already a descendant of ${sessionId}`,
      };
    return { ok: true };
  }
  return { ok: true };
}

/**
 * B takes A's place: B gets A's `parent` or `swarmId` (whichever was set), every session
 * with `parent === fromId` moves under B, and A gets `parent: toId, successor: toId` —
 * A stays in the swarm, one level under its own successor.
 *
 * Three rejections, checked against the pre-mutation graph (exact for each edge
 * individually, since neither of `toId`'s two new edges is the one just re-pointed):
 * - either side already has a `successor` — unresolved by the brief for what handing off
 *   from or to a session mid-handoff should do, so both are simply blocked for now.
 * - `toId` already resolves to a different swarm than `fromId`'s (a solo `toId` is always
 *   eligible; comparing either side against `undefined` must not itself count as
 *   "different swarms").
 * - edge (c) (`fromId`'s parent becomes `toId`) would create a cycle — `toId` is already
 *   `fromId`'s descendant. Checked as a single reassignment via `wouldCreateParentCycle`
 *   with `fromId` as the session being reassigned and `toId` as its candidate new parent,
 *   the same call shape `placeSession` uses for one edge.
 * - edge (a) (`toId`'s parent becomes `fromId`'s old parent `X`) would create a cycle —
 *   `toId` is `X` itself or already an ancestor of `X` reached back down through `fromId`
 *   (e.g. `X` is a child of `toId`). Only checked when `fromId` had a `parent` (not a bare
 *   `swarmId` — a swarm reassignment can't create a parent cycle).
 */
export function computeHandoff(overlay: OverlayState, fromId: string, toId: string): HandoffResult {
  const { placements } = overlay;
  const fromEntry: SessionPlacement = placements[fromId] ?? {};
  const toEntry: SessionPlacement = placements[toId] ?? {};

  if (fromEntry.successor !== undefined)
    return { ok: false, code: 'existing-successor', reason: `${fromId} already has a successor` };
  if (toEntry.successor !== undefined)
    return { ok: false, code: 'existing-successor', reason: `${toId} already has a successor` };

  const fromSwarm = resolveSwarmId(placements, fromId);
  const toSwarm = resolveSwarmId(placements, toId);
  if (toSwarm !== undefined && toSwarm !== fromSwarm)
    return {
      ok: false,
      code: 'cross-swarm',
      reason: `${toId} belongs to a different swarm than ${fromId}`,
    };

  if (wouldCreateParentCycle(placements, fromId, toId))
    return {
      ok: false,
      code: 'cycle',
      reason: `would create a cycle: ${toId} is already a descendant of ${fromId}`,
    };

  if (fromEntry.parent !== undefined && wouldCreateParentCycle(placements, toId, fromEntry.parent))
    return {
      ok: false,
      code: 'cycle',
      reason: `would create a cycle: ${toId} is already an ancestor of ${fromEntry.parent}`,
    };

  const next: Record<string, SessionPlacement> = { ...placements };

  // (a) toId takes fromId's exact placement.
  next[toId] =
    fromEntry.parent !== undefined
      ? { parent: fromEntry.parent }
      : fromEntry.swarmId !== undefined
        ? { swarmId: fromEntry.swarmId }
        : {};

  // (b) every child of fromId moves under toId.
  for (const [id, entry] of Object.entries(placements)) {
    if (entry.parent === fromId) next[id] = { ...entry, parent: toId };
  }

  // (c) fromId stays in the swarm, one level under its own successor.
  next[fromId] = { parent: toId, successor: toId };

  return { ok: true, placements: next };
}

/**
 * Drops overlay entries for any session id not in `knownSessionIds`, deleting swarms left
 * with zero members. Before dropping an unknown ancestor's own entry, splices its placement
 * onto every surviving entry that pointed at it — repeating until every remaining edge lands
 * on a known session or a root — so a live descendant doesn't get orphaned out of its swarm
 * just because an unrelated stale ancestor's transcript aged out under Claude Code's own
 * retention. The splice/clear checks test `knownSessionIds` directly rather than only
 * `placements`' own keys, so a `parent`/`successor` naming an id that never had a placements
 * entry of its own (the everyday case — see `resolveSwarmId`) still gets cleaned up once
 * that id itself stops being known, instead of dangling in the raw storage forever. Also
 * clears a `successor` field naming a now-unknown id.
 */
export function pruneOverlay(
  overlay: OverlayState,
  knownSessionIds: ReadonlySet<string>,
): OverlayState {
  const placements: Record<string, SessionPlacement> = { ...overlay.placements };
  const ownKeysToDelete = new Set(Object.keys(placements).filter((id) => !knownSessionIds.has(id)));
  let mutated = false;

  // Bounded by the entry count: a legitimate (acyclic) chain resolves one hop per pass, so it
  // cannot take more passes than there are entries. Only a hand-edited `state.json` with a
  // parent cycle among unknown ids could otherwise make this loop forever; the cap trades a
  // possibly-incomplete splice for that corrupt-file case against hanging the server at boot.
  const maxPasses = Object.keys(placements).length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const [id, entry] of Object.entries(placements)) {
      if (ownKeysToDelete.has(id)) continue;
      if (entry.parent === undefined || knownSessionIds.has(entry.parent)) continue;
      const dropped = placements[entry.parent];
      const spliced: SessionPlacement = { ...entry };
      delete spliced.parent;
      delete spliced.swarmId;
      if (dropped?.parent !== undefined) spliced.parent = dropped.parent;
      if (dropped?.swarmId !== undefined) spliced.swarmId = dropped.swarmId;
      placements[id] = spliced;
      changed = true;
      mutated = true;
    }
    if (!changed) break;
  }

  for (const [id, entry] of Object.entries(placements)) {
    if (entry.successor !== undefined && !knownSessionIds.has(entry.successor)) {
      const spliced = { ...entry };
      delete spliced.successor;
      placements[id] = spliced;
      mutated = true;
    }
  }

  if (ownKeysToDelete.size > 0) {
    for (const id of ownKeysToDelete) delete placements[id];
    mutated = true;
  }

  const swarms = overlay.swarms.filter((swarm) =>
    Object.keys(placements).some((id) => resolveSwarmId(placements, id) === swarm.id),
  );
  if (swarms.length !== overlay.swarms.length) mutated = true;

  // Same reference when nothing changed, so a caller like `pruneKnownSessions` can skip
  // writing a no-op back through `updateOverlay` with a plain `===` check.
  return mutated ? { ...overlay, placements, swarms } : overlay;
}
