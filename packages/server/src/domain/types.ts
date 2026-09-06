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
  | { type: 'hook'; payload: HookPayload }
  | { type: 'tmux-snapshot'; sessions: TmuxSessionFact[] };

export interface GardenState {
  sessions: SessionMap;
  /** The overlay fact from `state.json`: session id to tmux session name. */
  tmuxNames: Record<string, string>;
  tmux: Record<string, TmuxSessionFact>;
  ended: Record<string, boolean>;
  /** The latest status-bearing hook per session, by session id. */
  reported: Record<string, ReportedStatus>;
}
