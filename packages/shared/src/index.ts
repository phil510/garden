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

/**
 * How a preset arranges its slots. Tracks run along the root axis (`across` is side by side,
 * `stacked` is top to bottom) and each track splits evenly on the other axis. Slot indices are
 * implicit in reading order, so capacity and layout can't disagree. `weight` is relative to the
 * other tracks and defaults to an even share.
 */
export interface PresetArrangement {
  split: 'across' | 'stacked';
  tracks: { weight?: number; slots: number }[];
}

export const PRESET_ARRANGEMENTS: Record<StagePreset, PresetArrangement> = {
  single: { split: 'across', tracks: [{ slots: 1 }] },
  'two-across': { split: 'across', tracks: [{ slots: 1 }, { slots: 1 }] },
  'two-stacked': { split: 'stacked', tracks: [{ slots: 1 }, { slots: 1 }] },
  three: {
    split: 'across',
    tracks: [
      { weight: 0.55, slots: 1 },
      { weight: 0.45, slots: 2 },
    ],
  },
  'grid-2x2': { split: 'stacked', tracks: [{ slots: 2 }, { slots: 2 }] },
};

export function presetCapacity(preset: StagePreset): number {
  return PRESET_ARRANGEMENTS[preset].tracks.reduce((sum, track) => sum + track.slots, 0);
}

/** What a session's agent asked a human to look at. One per session; raising again replaces
 *  the text and keeps `raisedAt`. Epoch ms. */
export interface Alert {
  text: string;
  raisedAt: number;
  updatedAt: number;
}

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
  /** The session's PR watches, derived from the overlay by `reduce` so a change reaches clients
   *  as an ordinary session delta. Empty when the session has none. */
  watches: WatchSummary[];
  /** The session's open alert, derived from the overlay by `reduce`. Independent of `status`;
   *  it survives the session's death and a resume. Null when none is open. */
  alert: Alert | null;
  /** Whether a `garden events --follow` pipe is connected for this session. */
  pipeConnected: boolean;
  /** The last moment a pipe was known connected, as persisted; refreshed hourly while one is
   *  connected. Null when none has ever connected. */
  pipeLastConnectedAt: number | null;
  /** Swarm/placement fields, merged on from the overlay's `placements` map at read time
   *  (`app/projection.ts`). Mirrors `SessionPlacement`'s shape; absent for an unplaced
   *  session. Not derived by `domain/reduce.ts`/`domain/diff.ts`: a fresh HTTP `GET
   *  /sessions` always reflects the current placements, but a WS delta never carries
   *  these, so a browser client holding a session from an earlier snapshot would see them
   *  go stale after a later placement change/adopt — moot today, since nothing in
   *  `packages/web` reads them yet. */
  parent?: string;
  swarmId?: string;
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
  swarms: SwarmRecord[];
  /** Raw per-session placement, keyed by session id — not a resolved tree. A client walks
   *  `parent` up to a top-level ancestor itself to find a session's swarm. */
  placements: Record<string, SessionPlacement>;
  swarmOrder: string[];
  collapsedSwarms: string[];
  hideDeadSwarms: string[];
}

function frozen<T extends object>(value: T): T {
  return Object.freeze(value);
}

/** What a fresh install stores. Frozen all the way down because it is shared by reference. */
export const DEFAULT_UI_STATE: UiState = frozen({
  groupOrder: frozen([]),
  pinnedRepos: frozen([]),
  collapsedRepos: frozen([]),
  hideDeadRepos: frozen([]),
  preset: 'single',
  slots: frozen([null]),
  focusedSlot: 0,
  layout: frozen({}),
  swarms: frozen([]),
  placements: frozen({}),
  swarmOrder: frozen([]),
  collapsedSwarms: frozen([]),
  hideDeadSwarms: frozen([]),
});

export interface SwarmRecord {
  id: string;
  name: string;
  archived: boolean;
}

/** The per-session placement fields, shared between the server's overlay storage and the
 *  `UiState` wire shape so the two can't drift into separate shapes for the same fields.
 *  `parent` and `swarmId` are never both set — `Placement` below is what enforces that at
 *  the point of writing one. */
export interface SessionPlacement {
  parent?: string;
  swarmId?: string;
}

/** The one placement a session can hold: a top-level member of a swarm, a child of another
 *  session, or neither. Mutually exclusive by construction, so `parent` and `swarmId` set
 *  together is unrepresentable. */
export type Placement =
  { type: 'swarm'; swarmId: string } | { type: 'parent'; parentId: string } | { type: 'none' };

export interface CreateSwarmRequest {
  name: string;
}
export interface CreateSwarmResponse {
  id: string;
}
export interface RenameSwarmRequest {
  name: string;
}
export interface PlacementRequest {
  placement: Placement;
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
  swarmId?: string;
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
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}
/** A model alias or full name. Surrounding whitespace and a leading `-` are rejected, so a
 *  value can't be read as a `claude` flag or fail to resolve once spawned. */
export function isModelName(value: string): boolean {
  return value !== '' && value === value.trim() && !value.startsWith('-');
}
/** Passed through to the spawned `claude` as its own `--model` / `--effort`. */
export interface SpawnOptions {
  model?: string;
  effort?: EffortLevel;
}
export interface CreateSessionRequest extends SpawnOptions {
  cwd: string;
  callerSessionId?: string;
}
export type ResumeSessionRequest = SpawnOptions;
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
  claudeCommand: string;
  /** PR comment/review authors whose activity a watch does not report. */
  ignoreAuthors: string[];
  /** Minutes of PR quiet required before a digest is delivered. */
  quietWindowMinutes: number;
  /** Minutes between PR polls. */
  pollIntervalMinutes: number;
}
/** Body of `PUT /settings`: any non-empty subset of the writable keys. */
export type SettingsRequest = Partial<
  Pick<
    SettingsResponse,
    'claudeCommand' | 'ignoreAuthors' | 'quietWindowMinutes' | 'pollIntervalMinutes'
  >
>;
export const WATCH_KINDS = [
  'review',
  'comment',
  'checks',
  'checks:all',
  'conflict',
  'closed',
] as const;
/** What a watch reports on. `checks:all` also reports passing checks (and implies `checks`);
 *  `closed` is always on. */
export type WatchKind = (typeof WATCH_KINDS)[number];
export function isWatchKind(value: unknown): value is WatchKind {
  return typeof value === 'string' && (WATCH_KINDS as readonly string[]).includes(value);
}
export const DEFAULT_WATCH_KINDS: readonly WatchKind[] = [
  'review',
  'comment',
  'checks',
  'conflict',
  'closed',
];
export type WatchStatus = 'active' | 'error' | 'closed';
/** What clients see of a watch. `pendingDigest` says only that activity is waiting to be delivered. */
export interface WatchSummary {
  /** `owner/name`. */
  repo: string;
  pr: number;
  kinds: WatchKind[];
  pendingDigest: boolean;
  status: WatchStatus;
  /** Check run names and commit status contexts muted on this watch; empty when none. */
  ignoredChecks: readonly string[];
  /** Short plain-language cause, present only while `status` is `error`. */
  errorReason?: string;
}
/** The items a digest counted: ids and metadata only, never PR content. Times are ISO 8601. */
export interface DigestItems {
  reviews: { id: number; author: string; state: string; submittedAt: string }[];
  issueComments: { id: number; author: string; at: string }[];
  reviewComments: { id: number; author: string; reviewId: number | null; at: string }[];
  checkRuns: {
    id: number;
    name: string;
    conclusion: string;
    outcome: 'failed' | 'passed';
    completedAt: string;
    headSha: string | null;
  }[];
  statuses: {
    context: string;
    state: string;
    outcome: 'failed' | 'passed';
    updatedAt: string;
    headSha: string | null;
  }[];
  conflicts: { headSha: string | null; seenAt: string }[];
}

/** What one digest counted. `atMint` is the PR as of the poll that minted it; after a fold an
 *  earlier item may have been seen on a different sha, so each check, status and conflict item
 *  carries its own. `replaces` names the digest this one superseded, whose items it includes. */
export interface DigestDetail {
  id: string;
  repo: string;
  pr: number;
  line: string;
  createdAt: string;
  replaces: string | null;
  atMint: { headSha: string | null; mergeable: boolean | null };
  closed: { merged: boolean } | null;
  items: DigestItems;
}

export interface DigestResponse {
  digest: DigestDetail;
}
/** Body of `POST /sessions/:id/watches`. `repo` defaults to the session cwd's `origin`; a new
 *  watch's `kinds` default to the default set. Re-adding an existing watch replaces its kinds
 *  only when `kinds` is given. `ignoreChecks` and `unignoreChecks` add and remove muted check
 *  names; omitting both keeps the existing ignores. */
export interface AddWatchRequest {
  pr: number;
  repo?: string;
  kinds?: WatchKind[];
  ignoreChecks?: string[];
  unignoreChecks?: string[];
}
/** Body of `POST /sessions/:id/alert`. */
export interface RaiseAlertRequest {
  text: string;
}
export interface AlertResponse {
  alert: Alert;
}
export interface WatchResponse {
  watch: WatchSummary;
}
export interface WatchesResponse {
  watches: WatchSummary[];
}
export interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  gitStatus: string | null;
}
/** `GET /fs/tree` takes an optional `refresh` token. Requests for the same project that carry
 *  the same token share one `git status`, so send a fresh, globally unique token (a UUID) per
 *  refresh, backstop refetches included: a reused token is served its earlier status, which
 *  can predate the change being refetched. Without a token every request runs its own status. */
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
/** `swarms` and `placements` are absent on purpose: they move only through the swarm and
 *  placement use cases, never this generic patch. */
export type UiStateRequest = Partial<Omit<UiState, 'swarms' | 'placements'>>;

/** `WS /events`: a snapshot on connect, then deltas. `fs-changed` is the exception to
 *  projection-only: it goes only to the connection that sent `watch`, and `root` echoes the
 *  spelling that connection sent. */
export type ServerMessage =
  | { type: 'snapshot'; sessions: SessionState[]; uiState: UiState }
  | { type: 'deltas'; deltas: Delta[] }
  | { type: 'ui-state'; uiState: UiState }
  | { type: 'fs-changed'; root: string };

/** `WS /events`, client to server: replaces this connection's filesystem watch. `root` is a
 *  `RepoEntry.path`. */
export interface EventsClientMessage {
  type: 'watch';
  root: string;
}

/** `WS /sessions/:id/events`, server to client: one watch digest line to print. */
export type PipeServerMessage = { type: 'digest'; id: string; line: string };

/** `WS /sessions/:id/events`, client to server: the digest `id` has been printed and may be
 *  cleared. */
export type PipeClientMessage = { type: 'ack'; id: string };

/** Path of a session's pipe stream. */
export function pipeStreamPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}/events`;
}

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
