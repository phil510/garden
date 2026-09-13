import type { Delta, SessionsFilter, SessionState, UiState, UiStateRequest } from '@garden/shared';
import { diff } from '../domain/diff.js';
import { initialState, reduce } from '../domain/reduce.js';
import { filterSessions } from '../domain/sessionsFilter.js';
import { switchPreset } from '../domain/stage.js';
import type { GardenEvent } from '../domain/types.js';
import type { OverlayGroup, OverlayState, StorePort } from './ports.js';

export interface Projection {
  /** No argument: today's exact unfiltered behavior, for the four internal call sites that
   *  must keep seeing true state (repo-root sweep, name-dedup, the WS snapshot). A filter
   *  bounds the result for the HTTP route and the CLI. */
  sessions(filter?: SessionsFilter): SessionState[];
  uiState(): UiState;
  dispatch(event: GardenEvent): void;
  updateUiState(patch: UiStateRequest): void;
  subscribe(listener: (deltas: Delta[]) => void): () => void;
  subscribeUiState(listener: (uiState: UiState) => void): () => void;
}

/** The store keys groups by repo root; the client works in three flat lists. */
function toUiState(overlay: OverlayState): UiState {
  const entries = Object.entries(overlay.groups).sort((a, b) => a[1].order - b[1].order);
  return {
    hideDead: overlay.hideDead,
    groupOrder: entries.map(([path]) => path),
    pinnedRepos: entries.filter(([, group]) => group.pinned).map(([path]) => path),
    collapsedRepos: entries.filter(([, group]) => group.collapsed).map(([path]) => path),
    preset: overlay.stage.preset,
    slots: [...overlay.stage.slots],
    focusedSlot: overlay.stage.focusedSlot,
    layout: overlay.stage.layout,
  };
}

/** Folds the UI slice back onto an overlay read moments earlier, so fields the client
 *  never sees — the tmux name map — survive the write. */
function toOverlay(base: OverlayState, ui: UiState): OverlayState {
  const named = new Set([...ui.groupOrder, ...ui.pinnedRepos, ...ui.collapsedRepos]);
  const ordered = [...ui.groupOrder, ...[...named].filter((p) => !ui.groupOrder.includes(p))];
  const groups: Record<string, OverlayGroup> = {};
  ordered.forEach((path, order) => {
    groups[path] = {
      pinned: ui.pinnedRepos.includes(path),
      order,
      collapsed: ui.collapsedRepos.includes(path),
    };
  });
  return {
    ...base,
    hideDead: ui.hideDead,
    groups,
    stage: {
      ...base.stage,
      preset: ui.preset,
      slots: [...ui.slots],
      focusedSlot: ui.focusedSlot,
      layout: ui.layout,
    },
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
  };
}
