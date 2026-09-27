import type { Placement, SessionPlacement } from '@garden/shared';
import type { OverlayState } from './overlay.js';

type Placements = Readonly<Record<string, SessionPlacement>>;

export type DomainResult = { ok: true } | { ok: false; reason: string };

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
 * Drops overlay entries for any session id not in `knownSessionIds`, deleting swarms left
 * with zero members. Before dropping an unknown ancestor's own entry, splices its placement
 * onto every surviving entry that pointed at it — repeating until every remaining edge lands
 * on a known session or a root — so a live descendant doesn't get orphaned out of its swarm
 * just because an unrelated stale ancestor's transcript aged out under Claude Code's own
 * retention. The splice checks test `knownSessionIds` directly rather than only `placements`'
 * own keys, so a `parent` naming an id that never had a placements entry of its own (the
 * everyday case — see `resolveSwarmId`) still gets cleaned up once that id itself stops
 * being known, instead of dangling in the raw storage forever.
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
