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

/** A missing or unparseable file means a fresh install, not an error. */
export function readOverlayState(home: string): OverlayState {
  let text: string;
  try {
    text = readFileSync(statePath(home), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_OVERLAY_STATE;
    throw error;
  }
  try {
    return JSON.parse(text) as OverlayState;
  } catch {
    return DEFAULT_OVERLAY_STATE;
  }
}

/** Writes to a temp file beside the target and renames over it, so a reader
 *  never observes a partially written file. */
export function writeOverlayState(home: string, state: OverlayState): void {
  const dir = appDirPath(home);
  mkdirSync(dir, { recursive: true });
  const path = statePath(home);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, path);
}
