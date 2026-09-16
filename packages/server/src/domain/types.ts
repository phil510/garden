import type { HookPayload, SessionMap, Status } from '@garden/shared';

export type { HookPayload };

export interface TranscriptRecord {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
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
  | { type: 'transcript-changed'; path: string; record: TranscriptRecord }
  | { type: 'repo-root-resolved'; cwd: string; repoRoot: string }
  | { type: 'hook'; payload: HookPayload }
  | { type: 'tmux-snapshot'; sessions: TmuxSessionFact[] }
  | { type: 'claude-session-names-loaded'; names: Record<string, string> };

export interface GardenState {
  sessions: SessionMap;
  /** The overlay fact from `state.json`: session id to tmux session name. */
  tmuxNames: Record<string, string>;
  tmux: Record<string, TmuxSessionFact>;
  /** Resolved repo root by cwd. Keyed by directory rather than by session because that is
   *  what the root is a function of: sessions sharing a cwd share one answer, and an answer
   *  that lands before the session it describes is still waiting when the session appears. */
  repoRoots: Record<string, string>;
  ended: Record<string, boolean>;
  /** The latest status-bearing hook per session, by session id. */
  reported: Record<string, ReportedStatus>;
  /** The Claude session registry's latest snapshot, session id to Claude-side name. */
  claudeSessionNames: Record<string, string>;
}
