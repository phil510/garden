import type { StagePlacement } from '../sidebar/placeOnStage';

/** Exchanges the occupants of two slots — the dragged session's origin and the drop target. An
 *  empty target is just `null`, so the same exchange covers both swapping two occupied slots and
 *  moving a session into an empty one. Dropping back on the dragged session's own slot still
 *  focuses it there, matching a plain click; a dragged session no longer on stage (its pane
 *  closed mid-drag) or a target outside `slots` leaves both slots and focus untouched, matching
 *  `removeFromStage`'s no-op convention. */
export function swapSlots(
  slots: readonly (string | null)[],
  focusedSlot: number,
  draggedId: string,
  targetSlot: number,
): StagePlacement {
  const sourceSlot = slots.indexOf(draggedId);
  const targetInBounds = targetSlot >= 0 && targetSlot < slots.length;
  if (sourceSlot === -1 || !targetInBounds) {
    return { slots: [...slots], focusedSlot };
  }
  if (sourceSlot === targetSlot) {
    return { slots: [...slots], focusedSlot: targetSlot };
  }
  const next = [...slots];
  next[sourceSlot] = slots[targetSlot] ?? null;
  next[targetSlot] = draggedId;
  return { slots: next, focusedSlot: targetSlot };
}
