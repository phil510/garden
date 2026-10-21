import { DEFAULT_OVERLAY_STATE } from '../../../src/adapters/store.js';
import type { OverlayState, StorePort } from '../../../src/app/ports.js';

/** An in-memory overlay store, so a test never touches the app dir. */
export function fakeStore(): StorePort {
  let current: OverlayState = DEFAULT_OVERLAY_STATE;
  return {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
}
