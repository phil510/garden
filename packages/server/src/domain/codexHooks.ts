import type { HarnessSignal, ReportedStatus } from './types.js';

export interface CodexHook {
  session_id: string;
  cwd: string;
  transcript_path: string | null;
  hook_event_name: string;
  source?: string;
  _garden_order?: string;
}

export function codexHook(body: unknown): CodexHook | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value['session_id'] !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value['session_id']) ||
    typeof value['cwd'] !== 'string' ||
    (typeof value['transcript_path'] !== 'string' && value['transcript_path'] !== null) ||
    typeof value['hook_event_name'] !== 'string' ||
    (value['source'] !== undefined && typeof value['source'] !== 'string') ||
    (value['_garden_order'] !== undefined &&
      (typeof value['_garden_order'] !== 'string' || !/^\d{1,30}$/.test(value['_garden_order'])))
  )
    return null;
  return value as unknown as CodexHook;
}

export function codexSignal(
  hook: CodexHook,
  sessionId: string,
  conversationCleared = false,
): HarnessSignal {
  let reported: ReportedStatus | undefined;
  switch (hook.hook_event_name) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      reported = { status: 'working', reason: null };
      break;
    case 'PermissionRequest':
      reported = { status: 'needs-approval', reason: null };
      break;
    case 'Stop':
    case 'Interrupt':
      reported = { status: 'waiting', reason: null };
  }
  return {
    sessionId,
    cwd: hook.cwd,
    transcriptPath: hook.transcript_path,
    ...(reported === undefined ? {} : { reported }),
    ended:
      hook.hook_event_name === 'SessionEnd'
        ? true
        : hook.hook_event_name === 'SessionStart'
          ? false
          : null,
    conversationCleared,
  };
}
