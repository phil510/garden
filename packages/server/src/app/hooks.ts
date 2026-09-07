import type { HookPayload } from '@garden/shared';
import type { Projection } from './projection.js';

export interface HooksDeps {
  readonly projection: Projection;
}

/** A hook for a session id garden has not registered yet is stored under that id anyway —
 *  the transcript may not exist yet, and `reduce` derives the rest on its own. */
export function handleHook(deps: HooksDeps, payload: HookPayload): void {
  deps.projection.dispatch({ type: 'hook', payload });
}
