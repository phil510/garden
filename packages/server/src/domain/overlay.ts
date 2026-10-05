import type { SessionPlacement, StagePreset, SwarmRecord } from '@garden/shared';
import type { DigestRecord, Watch } from './watches.js';

export interface OverlayGroup {
  readonly pinned: boolean;
  readonly order: number;
  readonly collapsed: boolean;
  readonly hideDead: boolean;
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
  readonly groups: Readonly<Record<string, OverlayGroup>>;
  readonly stage: OverlayStage;
  readonly swarms: readonly SwarmRecord[];
  /** One entry per placed session, keyed by session id. `parent` and `swarmId` are never
   *  both set on one entry — that invariant is enforced at the point of writing
   *  (`domain/swarms.ts`'s `validatePlacement`), not by this type. */
  readonly placements: Readonly<Record<string, SessionPlacement>>;
  readonly swarmOrder: readonly string[];
  readonly collapsedSwarms: readonly string[];
  readonly hideDeadSwarms: readonly string[];
  readonly watches: readonly Watch[];
  /** Every minted digest's detail, kept after delivery and bounded by `archiveDigests`. */
  readonly digests: readonly DigestRecord[];
  /** Per session id, the last moment a pipe was known connected (epoch ms). */
  readonly pipes: Readonly<Record<string, number>>;
}
