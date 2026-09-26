export type SwarmScrollAction = 'idle' | 'expand-finished' | 'scroll';

/** Decides what a queued swarm-chip scroll target should do next: nothing (no target queued),
 *  expand the collapsed Finished section first (the target's swarm lives inside it and hasn't
 *  rendered into the DOM yet), or proceed straight to the scroll/flash. */
export function resolveSwarmScrollAction(
  selectedSwarmId: string | null,
  finishedOpen: boolean,
  finishedSwarmIds: readonly string[],
): SwarmScrollAction {
  if (selectedSwarmId === null) return 'idle';
  if (!finishedOpen && finishedSwarmIds.includes(selectedSwarmId)) return 'expand-finished';
  return 'scroll';
}
