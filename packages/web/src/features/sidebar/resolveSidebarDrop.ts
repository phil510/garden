import type { Placement, SessionPlacement } from '@garden/shared';

export type DropOutcome =
  | { type: 'reorder'; activeSwarmId: string; overSwarmId: string }
  | { type: 'place'; sessionId: string; placement: Placement }
  | { type: 'noop' };

export interface DropActive {
  /** 'swarm-reorder' for a swarm-header drag, 'session' for a row drag; anything else (or
   *  undefined) is a foreign drag this sidebar's DndContext shouldn't act on. */
  type: string | undefined;
  id: string;
}

export interface DropOver {
  /** 'swarm-reorder' (the whole swarm-group's own sortable — header-vs-header only),
   *  'swarm-header' (the header's own droppable — a session drops here), or 'solo'. */
  type: string | undefined;
  id: string;
  swarmId?: string | undefined;
}

/**
 * Resolves one `onDragEnd` to exactly one outcome: reordering two swarm headers, placing a
 * session (onto a swarm header or Solo), or a no-op. A no-op is any drop this sidebar's two
 * drag kinds don't recognize (a foreign `active`/`over` type, a header reorder dropped on
 * itself), plus two placement-specific no-ops that compare the dragged session's own raw
 * `parent`/`swarmId` fields rather than which bucket it currently resolves to — a session
 * already an unparented top-level member of the target swarm (or already an unparented Solo
 * root) is genuinely already there; one that only *resolves* there through a `parent` chain
 * still needs its `parent` cleared and is not a no-op.
 */
export function resolveSidebarDrop(
  active: DropActive,
  over: DropOver | null,
  currentPlacement: SessionPlacement | undefined,
): DropOutcome {
  if (over === null) return { type: 'noop' };

  if (active.type === 'swarm-reorder') {
    if (over.type !== 'swarm-reorder' || over.id === active.id) return { type: 'noop' };
    return { type: 'reorder', activeSwarmId: active.id, overSwarmId: over.id };
  }

  if (active.type !== 'session') return { type: 'noop' };

  if (over.type === 'swarm-header' && over.swarmId !== undefined) {
    const alreadyTopLevelHere =
      currentPlacement?.parent === undefined && currentPlacement?.swarmId === over.swarmId;
    if (alreadyTopLevelHere) return { type: 'noop' };
    return {
      type: 'place',
      sessionId: active.id,
      placement: { type: 'swarm', swarmId: over.swarmId },
    };
  }

  if (over.type === 'solo') {
    const alreadySoloRoot =
      currentPlacement?.parent === undefined && currentPlacement?.swarmId === undefined;
    if (alreadySoloRoot) return { type: 'noop' };
    return { type: 'place', sessionId: active.id, placement: { type: 'none' } };
  }

  return { type: 'noop' };
}
