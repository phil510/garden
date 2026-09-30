import { presetCapacity, type StagePreset } from '@garden/shared';

export interface StageLayout {
  slots: (string | null)[];
  focusedSlot: number;
}

/**
 * Truncates or pads the slot array to the new preset's capacity, keeping surviving panes in
 * their existing slot order; a pane that no longer fits is simply dropped from the array, which
 * is what returns it to the sidebar — being on stage is nothing more than being present here.
 * The focused slot moves to slot 0 when it no longer fits.
 */
export function switchPreset(
  slots: readonly (string | null)[],
  focusedSlot: number,
  preset: StagePreset,
): StageLayout {
  const capacity = presetCapacity(preset);
  const next: (string | null)[] = [];
  for (let i = 0; i < capacity; i++) next.push(slots[i] ?? null);
  const focusFits = focusedSlot >= 0 && focusedSlot < capacity;
  return { slots: next, focusedSlot: focusFits ? focusedSlot : 0 };
}
