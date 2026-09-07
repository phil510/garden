export interface StagePlacement {
  slots: (string | null)[];
  focusedSlot: number;
}

/** A session already on stage is only refocused, never duplicated into a second slot. Otherwise
 *  fills the first empty slot, falling back to replacing the focused slot when the stage is full. */
export function placeOnStage(
  slots: readonly (string | null)[],
  focusedSlot: number,
  id: string,
): StagePlacement {
  const existingIndex = slots.indexOf(id);
  if (existingIndex !== -1) {
    return { slots: [...slots], focusedSlot: existingIndex };
  }
  const emptyIndex = slots.indexOf(null);
  const targetIndex = emptyIndex !== -1 ? emptyIndex : focusedSlot;
  const next = [...slots];
  next[targetIndex] = id;
  return { slots: next, focusedSlot: targetIndex };
}
