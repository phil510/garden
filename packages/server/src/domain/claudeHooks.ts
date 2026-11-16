import type { HookPayload } from '@garden/shared';
import { hookOutcome } from './status.js';
import type { HarnessSignal } from './types.js';

export function claudeSignal(payload: HookPayload, gardenSessionId?: string): HarnessSignal {
  const outcome = hookOutcome(payload);
  return {
    sessionId: gardenSessionId ?? payload.session_id,
    cwd: payload.cwd,
    transcriptPath: payload.transcript_path,
    ...(outcome.status === null
      ? {}
      : { reported: { status: outcome.status, reason: outcome.reason } }),
    ended: outcome.ended,
    conversationCleared:
      gardenSessionId !== undefined &&
      payload.hook_event_name === 'SessionStart' &&
      payload.source === 'clear',
  };
}
