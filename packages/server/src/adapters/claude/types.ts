/** Claude Code's hook payload, verbatim snake_case. `permission_mode` is absent on
 *  SessionStart and SessionEnd. */
export interface HookPayload {
  session_id: string
  cwd: string
  transcript_path: string
  hook_event_name: string
  permission_mode?: string
  last_assistant_message?: string
  message?: string
  notification_type?: string
  /** Present only on SessionStart payloads: how the session came to start. */
  source?: 'startup' | 'resume' | 'clear' | 'compact' | 'fork'
}
