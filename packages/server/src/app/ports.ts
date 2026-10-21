import type { ConfigFile } from '../config.js';
import type { GhResult } from '../domain/github.js';
import type { TranscriptParse } from '../domain/transcript.js';
import type { GardenEvent } from '../domain/types.js';
import type { OverlayGroup, OverlayStage, OverlayState } from '../domain/overlay.js';

export type { GardenEvent, OverlayGroup, OverlayStage, OverlayState };

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
  readonly sessionId: string;
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

export { ConfigWriteRefusedError } from '../config.js';

/** `read` is tolerant, like `ensureConfigFile`: a missing or unusable file resolves to
 *  something usable, for live display. `write` is the strict half — it re-validates the
 *  on-disk file itself and refuses (throws `ConfigWriteRefusedError`) rather than
 *  serializing defaults over a file that failed to parse or validate. */
export interface ConfigPort {
  read(): ConfigFile;
  write(patch: Partial<ConfigFile>): void;
}

/** Tells the transcript watcher which files are being written right now, so they are polled
 *  every second instead of waiting for the slower discovery scan. */
export interface LiveTranscripts {
  track(path: string): void;
}

export interface TranscriptWatcher extends LiveTranscripts {
  close(): Promise<void>;
}

export interface TranscriptPort {
  listFiles(): Promise<string[]>;
  readRecord(path: string): Promise<TranscriptParse>;
  watch(
    onEvent: (event: Extract<GardenEvent, { type: 'transcript-changed' }>) => void,
  ): TranscriptWatcher;
}

export interface FsWatch {
  close(): void;
}

/** Watches one directory tree recursively. `onChange` is already debounced: one call per
 *  quiet period, and none after `close()`. */
export interface FsWatchPort {
  watch(root: string, onChange: () => void): FsWatch;
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

/** Conditional GETs against the GitHub REST API as the user's `gh` identity. `etag` is sent as
 *  `If-None-Match`; null asks unconditionally. */
export interface GhPort {
  get(path: string, etag: string | null): Promise<GhResult>;
}

export interface GitPort {
  repoRoot(cwd: string): Promise<string>;
  /** `cwd` relative to its working tree root, slash-terminated, empty at the root — the basis
   *  `status` reports its paths in. */
  workTreePrefix(cwd: string): Promise<string>;
  branch(cwd: string): Promise<string>;
  /** The `origin` remote's URL; null when the repository has no `origin`. */
  remoteUrl(cwd: string): Promise<string | null>;
  status(cwd: string): Promise<GitStatusEntry[]>;
}

/** The slice of `adapters/logger.ts`'s `Logger` that `http/routes/sessions.ts` needs, declared
 *  locally rather than imported — `docs/architecture.md` §6 forbids `http/` importing
 *  `adapters/`, and `adapters/store.ts`'s `StoreLogger` is the existing precedent for this. */
export interface Logger {
  warn(message: string): void;
  error(message: string): void;
}
