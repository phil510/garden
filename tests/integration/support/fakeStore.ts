import { DEFAULT_OVERLAY_STATE } from '../../../packages/server/src/adapters/store.js';
import type { OverlayState, StorePort } from '../../../packages/server/src/app/ports.js';

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
