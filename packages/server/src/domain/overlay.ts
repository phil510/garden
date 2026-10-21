import type { Alert, UiState } from '@garden/shared';
import type { DigestRecord, Watch } from './watches.js';

export type PersistedAlert = Alert & { readonly sessionId: string };

/** `~/.garden/state.json`. Overlay facts only — what garden decided and cannot
 *  recompute from tmux and the transcripts. */
export interface OverlayState {
  readonly version: 2;
  readonly tmuxNames: Readonly<Record<string, string>>;
  /** The client's `UiState` as stored, swarms and placements included. `swarms` and
   *  `placements` are written only through `updateOverlay` (`UiStateRequest` omits them); a
   *  placement's `parent` and `swarmId` are never both set — enforced at the point of writing
   *  (`domain/swarms.ts`'s `validatePlacement`), not by this type. */
  readonly ui: UiState;
  readonly watches: readonly Watch[];
  /** At most one entry per session id. */
  readonly alerts: readonly PersistedAlert[];
  /** Every minted digest's detail, kept after delivery and bounded by `archiveDigests`. */
  readonly digests: readonly DigestRecord[];
  /** Per session id, the last moment a pipe was known connected (epoch ms). */
  readonly pipes: Readonly<Record<string, number>>;
}
