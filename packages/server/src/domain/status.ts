import type { HookPayload, Status } from '@garden/shared';

export interface HookOutcome {
  /** null leaves the session's current status alone. */
  status: Status | null;
  reason: string | null;
  /** null leaves the ended flag alone. */
  ended: boolean | null;
}

const HOOK_STATUS: Record<string, Status> = {
  // No SessionStart source has a prompt in flight yet — every one sits at `waiting`
  // until the first UserPromptSubmit moves it to `working`.
  SessionStart: 'waiting',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PermissionRequest: 'needs-approval',
  Stop: 'waiting',
  Notification: 'waiting',
};

export function hookOutcome(payload: HookPayload): HookOutcome {
  const name = payload.hook_event_name;
  const isPermissionPromptNotification =
    name === 'Notification' && payload.notification_type === 'permission_prompt';
  return {
    status: isPermissionPromptNotification ? 'needs-approval' : (HOOK_STATUS[name] ?? null),
    reason: name === 'Notification' ? (payload.message ?? null) : null,
    ended: name === 'SessionEnd' ? true : name === 'SessionStart' ? false : null,
  };
}
