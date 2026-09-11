import type { StagePlacement } from '../sidebar/placeOnStage';

/** Exchanges the occupants of two slots — the dragged session's origin and the drop target. An
 *  empty target is just `null`, so the same exchange covers both swapping two occupied slots and
 *  moving a session into an empty one. The dragged session is always focused at its new slot. */
export function swapSlots(
  slots: readonly (string | null)[],
  draggedId: string,
  targetSlot: number,
): StagePlacement {
  const sourceSlot = slots.indexOf(draggedId);
  if (sourceSlot === -1 || sourceSlot === targetSlot) {
    return { slots: [...slots], focusedSlot: targetSlot };
  }
  const next = [...slots];
  next[sourceSlot] = slots[targetSlot] ?? null;
  next[targetSlot] = draggedId;
  return { slots: next, focusedSlot: targetSlot };
}
