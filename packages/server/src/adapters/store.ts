import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StagePreset } from '@garden/shared';
import { appDirPath } from '../config.js';

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

/** `~/.garden/state.json`. Overlay facts only — what garden decided and cannot
 *  recompute from tmux and the transcripts. */
export interface OverlayState {
  readonly version: 1;
  readonly tmuxNames: Readonly<Record<string, string>>;
  readonly hideDead: boolean;
  readonly groups: Readonly<Record<string, OverlayGroup>>;
  readonly stage: OverlayStage;
}

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  version: 1,
  tmuxNames: {},
  hideDead: false,
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
};

function statePath(home: string): string {
  return join(appDirPath(home), 'state.json');
}

/** The slice of `Logger` this adapter needs, declared locally rather than imported —
 *  one adapter per external system, composed together only in main.ts. */
export interface StoreLogger {
  warn(message: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every field the rest of the server reads without checking. A file that parses as
 *  JSON but does not answer this shape is as unusable as one that does not parse. */
function isOverlayState(value: unknown): value is OverlayState {
  if (!isRecord(value)) return false;
  return (
    value['version'] === 1 &&
    isRecord(value['tmuxNames']) &&
    typeof value['hideDead'] === 'boolean' &&
    isRecord(value['groups']) &&
    isRecord(value['stage'])
  );
}

/** A missing file means a fresh install. A file that is present but unreadable as an
 *  overlay is a loss worth reporting: `tmuxNames` maps session ids to the tmux names
 *  garden chose, and nothing can recompute it. */
export function readOverlayState(home: string, logger: StoreLogger): OverlayState {
  const path = statePath(home);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_OVERLAY_STATE;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    logger.warn(`ignoring unparseable ${path}: ${(error as Error).message}`);
    return DEFAULT_OVERLAY_STATE;
  }
  if (!isOverlayState(parsed)) {
    logger.warn(`ignoring ${path}: not a version 1 overlay state`);
    return DEFAULT_OVERLAY_STATE;
  }
  return parsed;
}

/** Writes to a temp file beside the target and renames over it, so a concurrent
 *  reader sees either the previous state or the new one, never a half-written file. */
export function writeOverlayState(home: string, state: OverlayState): void {
  const dir = appDirPath(home);
  mkdirSync(dir, { recursive: true });
  const path = statePath(home);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, path);
}
