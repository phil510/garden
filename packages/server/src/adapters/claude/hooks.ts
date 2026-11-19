import type { Status } from '@garden/shared'
import type { HookPayload } from './types.js'
import type { HarnessSignal } from '../../domain/types.js'

export function claudeSignal(payload: HookPayload, gardenSessionId?: string): HarnessSignal {
  const outcome = hookOutcome(payload)
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
  }
}

export interface HookOutcome {
  /** null leaves the session's current status alone. */
  status: Status | null
  reason: string | null
  /** null leaves the ended flag alone. */
  ended: boolean | null
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
}

export function hookOutcome(payload: HookPayload): HookOutcome {
  const name = payload.hook_event_name
  const isPermissionPromptNotification =
    name === 'Notification' && payload.notification_type === 'permission_prompt'
  return {
    status: isPermissionPromptNotification ? 'needs-approval' : (HOOK_STATUS[name] ?? null),
    reason: name === 'Notification' ? (payload.message ?? null) : null,
    ended: name === 'SessionEnd' ? true : name === 'SessionStart' ? false : null,
  }
}

export function parseClaudeHook(body: unknown, gardenSessionId?: string): HarnessSignal | null {
  if (typeof body !== 'object' || body === null) return null
  const { session_id, cwd, transcript_path, hook_event_name } = body as Record<string, unknown>
  if (
    typeof session_id !== 'string' ||
    typeof cwd !== 'string' ||
    typeof transcript_path !== 'string' ||
    typeof hook_event_name !== 'string'
  )
    return null
  return claudeSignal(body as HookPayload, gardenSessionId)
}
