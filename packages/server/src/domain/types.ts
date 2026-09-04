import type { HookPayload, SessionMap } from '@garden/shared';

export type { HookPayload };

export interface TranscriptRecord {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  title: string | null;
  lastPrompt: string | null;
  recap: string | null;
}

export interface TmuxSessionFact {
  name: string;
  paneDead: boolean;
  exitCode: number | null;
  attached: boolean;
}

export type GardenEvent =
  | { type: 'store-loaded'; tmuxNames: Record<string, string>; at: number }
  | { type: 'session-registered'; id: string; tmuxName: string; cwd: string; at: number }
  | {
      type: 'transcript-changed';
      path: string;
      record: TranscriptRecord;
      mtime: number;
      at: number;
    }
  | { type: 'hook'; payload: HookPayload; at: number }
  | { type: 'tmux-snapshot'; sessions: TmuxSessionFact[]; at: number }
  | { type: 'tick'; at: number };

export interface GardenState {
  sessions: SessionMap;
  /** The overlay fact from `state.json`: session id to tmux session name. */
  tmuxNames: Record<string, string>;
  tmux: Record<string, TmuxSessionFact>;
  ended: Record<string, boolean>;
  /** Monotonic: an event arriving with an older `at` never moves it backwards. */
  lastEventAt: number;
}
