import type { Delta, SessionsFilter, SessionState, UiState, UiStateRequest } from '@garden/shared';
import { diff } from '../domain/diff.js';
import { initialState, reduce } from '../domain/reduce.js';
import { filterSessions } from '../domain/sessionsFilter.js';
import { resolveSwarmId } from '../domain/swarms.js';
import { switchPreset } from '../domain/stage.js';
import type { GardenEvent } from '../domain/types.js';
import type { OverlayGroup, OverlayState, StorePort } from './ports.js';

/** A resolved single-session placement lookup for server-internal, non-UI callers (e.g. the
 *  CLI) that want the swarm walk already done rather than re-implementing `resolveSwarmId`
 *  themselves, the way the web sidebar does over the raw `UiState.placements` map. */
export interface ResolvedPlacement {
  parent?: string;
  swarmId?: string;
  successor?: string;
  topLevelSwarmId?: string;
}

export interface Projection {
  /** No argument: today's exact unfiltered behavior, for internal call sites that must keep
   *  seeing true state (the repo-root and branch sweeps, name-dedup, the WS snapshot, lookup
   *  by id). A filter bounds the result for the HTTP route and the CLI. */
  sessions(filter?: SessionsFilter): SessionState[];
  uiState(): UiState;
  dispatch(event: GardenEvent): void;
  updateUiState(patch: UiStateRequest): void;
  subscribe(listener: (deltas: Delta[]) => void): () => void;
  subscribeUiState(listener: (uiState: UiState) => void): () => void;
  /** Reads the store fresh, applies `mutate`, writes the result, refreshes the cached
   *  `uiState()` slice and notifies its subscribers — the one primitive swarm/placement
   *  writes go through, so a write here always reaches `uiState()` the same way a
   *  `updateUiState` write does. Swarm and placement mutations never go through
   *  `updateUiState`, which stays UI-patch-only. */
  updateOverlay(mutate: (base: OverlayState) => OverlayState): OverlayState;
  placementOf(sessionId: string): ResolvedPlacement | undefined;
}

/** The store keys groups by repo root; the client works in three flat lists. */
function toUiState(overlay: OverlayState): UiState {
  const entries = Object.entries(overlay.groups).sort((a, b) => a[1].order - b[1].order);
  return {
    groupOrder: entries.map(([path]) => path),
    pinnedRepos: entries.filter(([, group]) => group.pinned).map(([path]) => path),
    collapsedRepos: entries.filter(([, group]) => group.collapsed).map(([path]) => path),
    hideDeadRepos: entries.filter(([, group]) => group.hideDead).map(([path]) => path),
    preset: overlay.stage.preset,
    slots: [...overlay.stage.slots],
    focusedSlot: overlay.stage.focusedSlot,
    layout: overlay.stage.layout,
    swarms: [...overlay.swarms],
    placements: { ...overlay.placements },
    swarmOrder: [...overlay.swarmOrder],
    collapsedSwarms: [...overlay.collapsedSwarms],
    hideDeadSwarms: [...overlay.hideDeadSwarms],
  };
}

/** Folds the UI slice back onto an overlay read moments earlier, so fields the client
 *  never sees — the tmux name map — survive the write. */
function toOverlay(base: OverlayState, ui: UiState): OverlayState {
  const named = new Set([
    ...ui.groupOrder,
    ...ui.pinnedRepos,
    ...ui.collapsedRepos,
    ...ui.hideDeadRepos,
  ]);
  const ordered = [...ui.groupOrder, ...[...named].filter((p) => !ui.groupOrder.includes(p))];
  const groups: Record<string, OverlayGroup> = {};
  ordered.forEach((path, order) => {
    groups[path] = {
      pinned: ui.pinnedRepos.includes(path),
      order,
      collapsed: ui.collapsedRepos.includes(path),
      hideDead: ui.hideDeadRepos.includes(path),
    };
  });
  return {
    ...base,
    groups,
    stage: {
      ...base.stage,
      preset: ui.preset,
      slots: [...ui.slots],
      focusedSlot: ui.focusedSlot,
      layout: ui.layout,
    },
    swarmOrder: [...ui.swarmOrder],
    collapsedSwarms: [...ui.collapsedSwarms],
    hideDeadSwarms: [...ui.hideDeadSwarms],
  };
}

export function createProjection(store: StorePort): Projection {
  let state = initialState;
  let ui = toUiState(store.read());
  const listeners = new Set<(deltas: Delta[]) => void>();
  const uiListeners = new Set<(uiState: UiState) => void>();

  return {
    sessions: (filter) => {
      const all = Object.values(state.sessions);
      return filter === undefined ? all : filterSessions(all, filter, Date.now());
    },
    uiState: () => ui,

    dispatch(event) {
      const prev = state;
      state = reduce(state, event);
      const deltas = diff(prev, state);
      if (deltas.length === 0) return;
      for (const listener of [...listeners]) listener(deltas);
    },

    updateUiState(patch) {
      // The store write is what makes the change real, so it lands before the
      // in-memory slice moves: a failed write leaves nothing claiming to have applied.
      const base = store.read();
      const merged = { ...toUiState(base), ...patch };
      // The preset decides how many slots exist, so the slot array is fitted to it here rather
      // than trusted from the client: a patch naming a smaller preset returns the panes that no
      // longer fit to the sidebar, and every other patch leaves an already-fitting stage alone.
      const next = { ...merged, ...switchPreset(merged.slots, merged.focusedSlot, merged.preset) };
      store.write(toOverlay(base, next));
      ui = next;
      for (const listener of [...uiListeners]) listener(ui);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    subscribeUiState(listener) {
      uiListeners.add(listener);
      return () => uiListeners.delete(listener);
    },

    updateOverlay(mutate) {
      // Same ordering as updateUiState: the store write is what makes the change real, so
      // it lands before the in-memory ui slice moves. A `mutate` that decides there is
      // nothing to do (e.g. pruning with nothing stale) returns its own `base` back
      // unchanged; that exact reference is the signal to skip the write and the
      // notification rather than persist and broadcast a no-op.
      const base = store.read();
      const next = mutate(base);
      if (next === base) return next;
      store.write(next);
      ui = toUiState(next);
      for (const listener of [...uiListeners]) listener(ui);
      return next;
    },

    placementOf(sessionId) {
      const { placements } = store.read();
      const entry = placements[sessionId];
      if (entry === undefined) return undefined;
      const topLevelSwarmId = resolveSwarmId(placements, sessionId);
      return {
        ...entry,
        ...(topLevelSwarmId === undefined ? {} : { topLevelSwarmId }),
      };
    },
  };
}
