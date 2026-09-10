import type { TranscriptParse } from '../domain/transcript.js';
import type { GardenEvent } from '../domain/types.js';
import type { OverlayGroup, OverlayStage, OverlayState } from '../domain/overlay.js';

export type { OverlayGroup, OverlayStage, OverlayState };

/** app/ never sees the tmux target (socket, conf path): main.ts binds it once when it
 *  wires the adapter into this port. */
export interface TmuxPaneFact {
  readonly session: string;
  readonly dead: boolean;
  readonly exitCode: number | undefined;
}

export interface TmuxNewSessionRequest {
  readonly name: string;
  readonly cwd: string;
  readonly port: number;
  readonly command: readonly string[];
}

export interface TmuxRespawnRequest {
  readonly name: string;
  readonly command: readonly string[];
}

export interface TmuxPort {
  listPanes(): Promise<TmuxPaneFact[]>;
  newSession(request: TmuxNewSessionRequest): Promise<void>;
  respawnPane(request: TmuxRespawnRequest): Promise<void>;
  killSession(name: string): Promise<void>;
}

export interface StorePort {
  read(): OverlayState;
  write(state: OverlayState): void;
}

export interface TranscriptWatcher {
  close(): Promise<void>;
}

export interface TranscriptPort {
  listFiles(): Promise<string[]>;
  readRecord(path: string): Promise<TranscriptParse>;
  watch(
    onEvent: (event: Extract<GardenEvent, { type: 'transcript-changed' }>) => void,
  ): TranscriptWatcher;
}

export interface PaneSize {
  readonly cols: number;
  readonly rows: number;
}

/** One pty attached to one tmux session. Killing it detaches; the session survives. */
export interface PaneAttachment {
  write(data: string): void;
  resize(size: PaneSize): void;
  kill(): void;
}

export interface PtyPort {
  attach(
    tmuxName: string,
    size: PaneSize,
    handlers: { onData: (chunk: string) => void; onExit: () => void },
  ): PaneAttachment;
}

export interface GitStatusEntry {
  readonly path: string;
  readonly status: string;
}

export interface WorktreeInfo {
  readonly path: string;
  readonly name: string;
}

export interface GitPort {
  repoRoot(cwd: string): Promise<string>;
  /** `cwd` relative to its working tree root, slash-terminated, empty at the root — the basis
   *  `status` reports its paths in. */
  workTreePrefix(cwd: string): Promise<string>;
  branch(cwd: string): Promise<string>;
  status(cwd: string): Promise<GitStatusEntry[]>;
  /** The linked worktree `cwd` sits inside, or null when its working tree is the main checkout. */
  worktree(cwd: string): Promise<WorktreeInfo | null>;
}
