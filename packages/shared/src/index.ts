/** Body of the server's `GET /health` response. */
export interface HealthStatus {
  status: 'ok';
}

export type Liveness = 'live' | 'exited' | 'external' | 'dead';
export type Status = 'working' | 'needs-approval' | 'waiting' | 'unknown';
export type StagePreset = 'single' | 'two-side' | 'two-stack' | 'three' | '2x2';

export interface SessionState {
  id: string;
  cwd: string;
  repoRoot: string | null;
  branch: string | null;
  title: string | null;
  recap: string | null;
  liveness: Liveness;
  /** Meaningful while `live` or `external`; forced to `unknown` once a session is gone. */
  status: Status;
  statusReason: string | null;
  exitCode: number | null;
  tmuxName: string | null;
  attached: boolean;
  /** Transcript mtime, or the time of the last hook, in epoch ms. */
  lastActivity: number;
}

export type SessionMap = Record<string, SessionState>;

export type Delta =
  | { type: 'session-added'; session: SessionState }
  | { type: 'session-changed'; id: string; changes: Partial<SessionState> };

export interface UiState {
  hideDead: boolean;
  groupOrder: string[];
  pinnedRepos: string[];
  collapsedRepos: string[];
  preset: StagePreset;
  slots: (string | null)[];
  focusedSlot: number;
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
}

export interface SessionsResponse {
  sessions: SessionState[];
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
export interface FileResponse {
  path: string;
  text: string;
  truncated: boolean;
}
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
