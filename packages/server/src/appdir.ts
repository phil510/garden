import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Passed as `-f` on every tmux command. remain-on-exit must be in force when the
 * server starts, which a conf file guarantees and a later set-option cannot.
 */
export const TMUX_CONF = [
  'set-option -g remain-on-exit on',
  'set-option -g mouse on',
  'set-option -g status off',
  'set-option -g default-terminal tmux-256color',
  'set-option -g terminal-features ",*:RGB"',
  'set-option -g aggressive-resize on',
  'set-option -g window-size latest',
  '',
].join('\n');

/** Writes the conf, replacing any previous copy, and returns its path. */
export function writeTmuxConf(appDir: string): string {
  mkdirSync(appDir, { recursive: true });
  const path = join(appDir, 'tmux.conf');
  writeFileSync(path, TMUX_CONF, 'utf8');
  return path;
}

interface HookCommand {
  readonly type: 'command';
  readonly command: string;
  readonly timeout: number;
}
interface HookMatcherGroup {
  readonly matcher?: string;
  readonly hooks: readonly HookCommand[];
}
export interface ClaudeSettings {
  readonly hooks: Readonly<Record<string, readonly HookMatcherGroup[]>>;
}

// -o /dev/null discards the response because a hook's stdout is interpreted by
// Claude Code; `|| true` keeps a missing server from failing the hook, which for
// PreToolUse would block the tool call. The X-Garden-Session header carries the pane's garden id,
// which the payload's `session_id` stops being after `/clear`.
const HOOK_COMMAND =
  "curl -s -o /dev/null --max-time 1 -H 'Content-Type: application/json' " +
  '-H "X-Garden-Session: $GARDEN_SESSION_ID" --data-binary @- "http://127.0.0.1:$GARDEN_PORT/hooks" || true';

/** Synchronous, never `async: true`: an async hook is killed when claude exits, so SessionEnd
 *  would never land. A down server refuses instantly; `timeout: 1` is Claude Code's own cap,
 *  matching curl's `--max-time`, on the stall when the server is up but unresponsive. */
const POST_HOOK: HookCommand = { type: 'command', command: HOOK_COMMAND, timeout: 1 };

const LIFECYCLE_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'Notification',
] as const;
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PermissionRequest'] as const;

export function claudeSettings(): ClaudeSettings {
  const hooks: Record<string, readonly HookMatcherGroup[]> = {};
  // Session-lifecycle events take no matcher; the tool events match every tool.
  for (const event of LIFECYCLE_EVENTS) hooks[event] = [{ hooks: [POST_HOOK] }];
  for (const event of TOOL_EVENTS) hooks[event] = [{ matcher: '*', hooks: [POST_HOOK] }];
  return { hooks };
}

/** Writes the hook overlay, replacing any previous copy, and returns its path. */
export function writeClaudeSettings(appDir: string): string {
  mkdirSync(appDir, { recursive: true });
  const path = join(appDir, 'claude-settings.json');
  writeFileSync(path, `${JSON.stringify(claudeSettings(), null, 2)}\n`, 'utf8');
  return path;
}
