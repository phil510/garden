/** Body of the server's `GET /health` response. */
export interface HealthStatus {
  status: 'ok';
}

export type Liveness = 'live' | 'dead';
export const STATUSES = ['working', 'needs-approval', 'waiting', 'unknown'] as const;
export type Status = (typeof STATUSES)[number];
export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}
export const STAGE_PRESETS = ['single', 'two-across', 'two-stacked', 'three', 'grid-2x2'] as const;
export type StagePreset = (typeof STAGE_PRESETS)[number];

export interface SessionState {
  id: string;
  cwd: string;
  repoRoot: string | null;
  branch: string | null;
  title: string | null;
  recap: string | null;
  liveness: Liveness;
  /** Live sessions only, `unknown` until the first hook arrives. Null while dead. */
  status: Status | null;
  statusReason: string | null;
  exitCode: number | null;
  tmuxName: string | null;
  /** The last timestamped transcript line, in epoch ms. Display, sorting and filtering only;
   *  liveness never reads it. */
  lastActivity: number;
  /** The Claude-side addressable name (e.g. `garden-7a`) read from the Claude session
   *  registry. Null when the registry carries no entry for this session's id. */
  claudeSessionName: string | null;
}

export type SessionMap = Record<string, SessionState>;

export type Delta =
  | { type: 'session-added'; session: SessionState }
  | { type: 'session-changed'; id: string; changes: Partial<SessionState> };

export interface UiState {
  hideDeadRepos: string[];
  groupOrder: string[];
  pinnedRepos: string[];
  collapsedRepos: string[];
  preset: StagePreset;
  slots: (string | null)[];
  focusedSlot: number;
  /** dockview's own `toJSON()` output, carrying the track sizes the user dragged. Opaque
   *  everywhere but `fromJSON`; null until the stage has been laid out once. */
  layout: unknown;
}

/** Claude Code's hook payload, verbatim snake_case. `permission_mode` is absent on
 *  SessionStart and SessionEnd. */
export interface HookPayload {
  session_id: string;
  cwd: string;
  transcript_path: string;
  hook_event_name: string;
  permission_mode?: string;
  last_assistant_message?: string;
  message?: string;
  notification_type?: string;
  /** Present only on SessionStart payloads: how the session came to start. */
  source?: 'startup' | 'resume' | 'clear' | 'compact' | 'fork';
}

export interface SessionsResponse {
  sessions: SessionState[];
}
/** Passed to `Projection.sessions(filter)` from the HTTP route and the CLI. Omitting a field
 *  applies its default (7 days, 500 chars) rather than leaving that dimension unbounded. */
export interface SessionsFilter {
  sinceDays?: number;
  maxRecapChars?: number;
  live?: boolean;
  status?: Status;
}

/** Validates a raw CLI flag or query-string value as a non-negative integer before any
 *  numeric coercion. `Number('')` and `Number('  ')` are both `0`, so checking the coerced
 *  result alone lets an empty value through silently; checking the raw string first closes
 *  that. Returns `undefined` for anything that isn't a non-negative integer, including
 *  empty or whitespace-only input, or a non-string value. Both call sites (the HTTP route's
 *  `sessions.ts` and the CLI's `run.ts`) now guarantee a `string` before calling this, so the
 *  `typeof` check is defense-in-depth against a future caller that doesn't — kept because a
 *  400 from this guard is a more legible failure than a `TypeError` from `raw.trim()`. */
export function parseNonNegativeInt(raw: string): number | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}
export interface CreateSessionRequest {
  cwd: string;
}
export interface CreateSessionResponse {
  id: string;
  tmuxName: string;
}
export interface OkResponse {
  ok: true;
}
export interface ErrorResponse {
  error: string;
}
export interface RepoEntry {
  path: string;
  name: string;
  branch: string | null;
  isWorktree: boolean;
}
export interface ReposResponse {
  repos: RepoEntry[];
}
/** Body of the server's `GET /settings` response — the client-side settings from `config.json`. */
export interface SettingsResponse {
  deadSessionCap: number;
  terminalFontSize: number;
}
export interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  gitStatus: string | null;
}
export interface TreeResponse {
  path: string;
  entries: TreeEntry[];
}
/** `truncated` splits the `image` variant into two shapes rather than making `data` an
 *  optional field on one: `truncated: false` always carries `data`, `truncated: true` never
 *  does, so a mismatched pair is unrepresentable instead of a runtime check away. */
export type FileResponse =
  | { path: string; kind: 'text'; text: string; truncated: boolean }
  | { path: string; kind: 'image'; mimeType: string; truncated: true }
  | { path: string; kind: 'image'; mimeType: string; truncated: false; data: string }
  | { path: string; kind: 'binary' };
export type UiStateRequest = Partial<UiState>;

/** `WS /events`: a snapshot on connect, then deltas. */
export type ServerMessage =
  | { type: 'snapshot'; sessions: SessionState[]; uiState: UiState }
  | { type: 'deltas'; deltas: Delta[] }
  | { type: 'ui-state'; uiState: UiState };

/** `WS /attach/:id`: bytes are binary frames, resize is JSON. */
export interface PaneResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

/** Close codes `WS /attach/:id` uses to end the connection: a normal close (RFC 6455 §7.4.1)
 *  for the pty having exited, and one private-use code (RFC 6455 §7.4.2) per refusal reason so
 *  the client can tell them apart. */
export const PANE_CLOSE_CODES = {
  PTY_EXITED: 1000,
  BAD_REQUEST: 4000,
  SESSION_NOT_RUNNING: 4001,
  SESSION_NOT_FOUND: 4004,
  ALREADY_ATTACHED: 4009,
  ATTACH_FAILED: 4500,
} as const;

/** Close codes `WS /events` uses to end the connection: its own private-use range (RFC 6455
 *  §7.4.2), separate from `PANE_CLOSE_CODES` because the two sockets close for unrelated
 *  reasons. `DELIBERATE_SHUTDOWN` is sent when the garden server itself is stopping, so the
 *  client knows not to reconnect. */
export const EVENTS_CLOSE_CODES = {
  DELIBERATE_SHUTDOWN: 4100,
} as const;

export function applyDelta(sessions: SessionMap, deltas: readonly Delta[]): SessionMap {
  const next: SessionMap = { ...sessions };
  for (const delta of deltas) {
    if (delta.type === 'session-added') {
      next[delta.session.id] = delta.session;
      continue;
    }
    const prev = next[delta.id];
    if (prev !== undefined) next[delta.id] = { ...prev, ...delta.changes };
  }
  return next;
}
