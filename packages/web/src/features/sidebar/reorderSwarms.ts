import { arrayMove } from '@dnd-kit/sortable';

/**
 * Dragging a swarm moves it within `visibleOrder` (the swarms in the sequence they were
 * rendered) to `overSwarmId`'s position. Unlike repo groups, swarms have no separate
 * pinned/unpinned tier — every swarm participates in `swarmOrder` — so the moved sequence
 * itself becomes the new order.
 */
export function reorderSwarms(
  visibleOrder: string[],
  activeSwarmId: string,
  overSwarmId: string,
): string[] {
  return arrayMove(
    visibleOrder,
    visibleOrder.indexOf(activeSwarmId),
    visibleOrder.indexOf(overSwarmId),
  );
}
