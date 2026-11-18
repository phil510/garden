import type { HookPayload } from './types.js'

export function aHookEvent(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'a1b2c3d4-0000-4000-8000-000000000001',
    cwd: '/Users/dev/repo',
    transcript_path:
      '/Users/dev/.claude/projects/-Users-dev-repo/a1b2c3d4-0000-4000-8000-000000000001.jsonl',
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'default',
    ...overrides,
  }
}
