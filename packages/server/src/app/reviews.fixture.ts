import { DEFAULT_UI_STATE } from '@garden/shared';
import type { OverlayState } from '../domain/overlay.js';
import type { Projection } from './projection.js';

/** The slice of the projection the review store uses, over an overlay held in memory. */
export function memoryOverlay(
  links: Record<string, string> = {},
): Pick<Projection, 'overlay' | 'updateOverlay'> & { writes: OverlayState[] } {
  let state: OverlayState = {
    version: 2,
    tmuxNames: {},
    ui: DEFAULT_UI_STATE,
    watches: [],
    alerts: [],
    digests: [],
    pipes: {},
    reviews: { links },
  };
  const writes: OverlayState[] = [];
  return {
    writes,
    overlay: () => state,
    updateOverlay(mutate) {
      state = mutate(state);
      writes.push(state);
      return state;
    },
  };
}
