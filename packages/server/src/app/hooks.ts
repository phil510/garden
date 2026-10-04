import type { HookPayload } from '@garden/shared';
import { dropSessionWatches } from '../domain/watches.js';
import type { Projection } from './projection.js';
import { updateWatches } from './watches.js';

export interface HooksDeps {
  readonly projection: Projection;
}

/** A hook for a session id garden has not registered yet is stored under that id anyway —
 *  the transcript may not exist yet, and `reduce` derives the rest on its own.
 *
 *  `gardenSessionId` is the hook process's own `GARDEN_SESSION_ID`. A SessionStart with
 *  `source: "clear"` ends that session's watches; the payload `session_id` is no use for this,
 *  because `/clear` replaces it with a new Claude id garden has no mapping for. */
export function handleHook(
  deps: HooksDeps,
  payload: HookPayload,
  gardenSessionId: string | undefined,
): void {
  deps.projection.dispatch({ type: 'hook', payload });
  if (
    payload.hook_event_name === 'SessionStart' &&
    payload.source === 'clear' &&
    gardenSessionId !== undefined
  )
    updateWatches(deps, (watches) => dropSessionWatches(watches, gardenSessionId), Date.now());
}
