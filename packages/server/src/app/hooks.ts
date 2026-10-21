import type { HookPayload } from '@garden/shared';
import { dropSessionWatches } from '../domain/watches.js';
import type { LiveTranscripts } from './ports.js';
import type { Projection } from './projection.js';
import { updateWatches } from './watches.js';

export interface HooksDeps {
  readonly projection: Projection;
  readonly liveTranscripts: LiveTranscripts;
}

/** Every hook's `transcript_path` is the authoritative live path, including after `/clear`.
 *
 *  A hook for a session id garden has not registered yet is stored under that id anyway —
 *  the transcript may not exist yet, and `reduce` derives the rest on its own.
 *
 *  `gardenSessionId` is the hook process's own `GARDEN_SESSION_ID`, empty or absent for a hook
 *  from a Claude garden did not start. `reduce` keys the hook on it, and a SessionStart with
 *  `source: "clear"` ends that session's watches; the payload `session_id` is no use for either,
 *  because `/clear` replaces it with a new Claude id garden has no mapping for. */
export function handleHook(
  deps: HooksDeps,
  payload: HookPayload,
  gardenSessionId: string | undefined,
): void {
  deps.liveTranscripts.track(payload.transcript_path);
  deps.projection.dispatch({ type: 'hook', payload, gardenSessionId });
  if (
    payload.hook_event_name === 'SessionStart' &&
    payload.source === 'clear' &&
    gardenSessionId !== undefined
  )
    updateWatches(deps, (watches) => dropSessionWatches(watches, gardenSessionId), Date.now());
}
