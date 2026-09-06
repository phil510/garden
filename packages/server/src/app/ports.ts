import type { StagePreset } from '@garden/shared';
import type { TranscriptParse } from '../domain/transcript.js';
import type { GardenEvent } from '../domain/types.js';

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

/** `~/.garden/state.json`'s shape: overlay facts only, never a `SessionState` snapshot. */
export interface OverlayGroup {
  readonly pinned: boolean;
  readonly order: number;
  readonly collapsed: boolean;
}

export interface OverlayStage {
  readonly preset: StagePreset;
  readonly slots: readonly (string | null)[];
  readonly focusedSlot: number;
  /** dockview's own `toJSON()` output. Opaque here; only `fromJSON` reads inside it. */
  readonly layout: unknown;
}

export interface OverlayState {
  readonly version: 1;
  readonly tmuxNames: Readonly<Record<string, string>>;
  readonly hideDead: boolean;
  readonly groups: Readonly<Record<string, OverlayGroup>>;
  readonly stage: OverlayStage;
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

export interface GitPort {
  repoRoot(cwd: string): Promise<string>;
  branch(cwd: string): Promise<string>;
  status(cwd: string): Promise<GitStatusEntry[]>;
}
