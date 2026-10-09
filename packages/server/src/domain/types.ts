import type { HookPayload, SessionMap, Status, WatchSummary } from '@garden/shared';

export type { HookPayload };

export interface TranscriptRecord {
  sessionId: string | null;
  cwd: string | null;
  title: string | null;
  lastPrompt: string | null;
  recap: string | null;
  /** Epoch ms of the last line carrying a `timestamp`; null when no line carries one. */
  lastActivity: number | null;
}

export interface TmuxSessionFact {
  name: string;
  paneDead: boolean;
  exitCode: number | null;
}

/** The status a hook reported, with the reason that came with it. */
export interface ReportedStatus {
  status: Status;
  reason: string | null;
}

export type GardenEvent =
  | { type: 'store-loaded'; tmuxNames: Record<string, string> }
  | { type: 'session-registered'; id: string; tmuxName: string; cwd: string }
  | { type: 'session-unregistered'; id: string }
  | { type: 'transcript-changed'; path: string; record: TranscriptRecord }
  | { type: 'repo-root-resolved'; cwd: string; repoRoot: string }
  | { type: 'branch-resolved'; cwd: string; branch: string | null }
  /** `gardenSessionId` is the hook process's own `GARDEN_SESSION_ID`. It names the session
   *  the hook belongs to when present, because `/clear` gives Claude a new payload `session_id`
   *  while the process, pane and garden session stay the same. */
  | { type: 'hook'; payload: HookPayload; gardenSessionId?: string | undefined }
  | { type: 'tmux-snapshot'; sessions: TmuxSessionFact[] }
  | { type: 'claude-session-names-loaded'; names: Record<string, string> }
  /** The full, current summary list for one session; an empty list means it has none. */
  | { type: 'watches-changed'; sessionId: string; watches: WatchSummary[] }
  /** Whether a pipe is connected for one session, and when one last was. */
  | { type: 'pipe-changed'; sessionId: string; connected: boolean; lastConnectedAt: number | null };

export interface PipeFact {
  connected: boolean;
  lastConnectedAt: number | null;
}

export interface GardenState {
  sessions: SessionMap;
  /** The overlay fact from `state.json`: session id to tmux session name. */
  tmuxNames: Record<string, string>;
  tmux: Record<string, TmuxSessionFact>;
  /** Resolved repo root by cwd. Keyed by directory rather than by session because that is
   *  what the root is a function of: sessions sharing a cwd share one answer, and an answer
   *  that lands before the session it describes is still waiting when the session appears. */
  repoRoots: Record<string, string>;
  /** Resolved branch by cwd, keyed the same way as `repoRoots`. Unlike a repo root, a branch
   *  can stop being current for a cwd that stays a valid git directory, so a failed lookup is
   *  recorded as `null` here rather than left unresolved — see `app/branches.ts`. */
  branches: Record<string, string | null>;
  ended: Record<string, boolean>;
  /** The latest status-bearing hook per session, by session id. */
  reported: Record<string, ReportedStatus>;
  /** The Claude session registry's latest snapshot, session id to Claude-side name. */
  claudeSessionNames: Record<string, string>;
  /** Watch summaries by session id, keyed like `repoRoots` so an entry that lands before its
   *  session is still waiting when the session appears. A session with no watches has no key. */
  watches: Record<string, WatchSummary[]>;
  /** Pipe connection facts by session id, keyed like `watches`. A session with no entry has
   *  never had a pipe as far as garden knows. */
  pipes: Record<string, PipeFact>;
}
