import type { StagePreset } from '@garden/shared';

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
