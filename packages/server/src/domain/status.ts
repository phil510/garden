import type { HookPayload, Status } from '@garden/shared';

export interface HookOutcome {
  /** null leaves the session's current status alone. */
  status: Status | null;
  reason: string | null;
  /** null leaves the ended flag alone. */
  ended: boolean | null;
}

const HOOK_STATUS: Record<string, Status> = {
  SessionStart: 'working',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PermissionRequest: 'needs-approval',
  Stop: 'waiting',
  Notification: 'waiting',
};

export function hookOutcome(payload: HookPayload): HookOutcome {
  const name = payload.hook_event_name;
  return {
    status: HOOK_STATUS[name] ?? null,
    reason: name === 'Notification' ? (payload.message ?? null) : null,
    ended: name === 'SessionEnd' ? true : name === 'SessionStart' ? false : null,
  };
}
