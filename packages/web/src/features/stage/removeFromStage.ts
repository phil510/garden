import type { StagePlacement } from '../sidebar/placeOnStage';

/** The reverse of `placeOnStage`: clears the session's slot without touching focus. The slot
 *  renders the empty placeholder from then on, and `Stage`'s panel-removal handler tears down
 *  the pane's terminal and socket once the layout drops it. Killing the session is a separate
 *  action entirely — this only changes what is shown. */
export function removeFromStage(
  slots: readonly (string | null)[],
  focusedSlot: number,
  id: string,
): StagePlacement {
  const index = slots.indexOf(id);
  if (index === -1) return { slots: [...slots], focusedSlot };
  const next = [...slots];
  next[index] = null;
  return { slots: next, focusedSlot };
}
