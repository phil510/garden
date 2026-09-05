import type { Delta, SessionState, UiState, UiStateRequest } from '@garden/shared';
import { diff } from '../domain/diff.js';
import { initialState, reduce } from '../domain/reduce.js';
import type { GardenEvent } from '../domain/types.js';
import type { OverlayGroup, OverlayState, StorePort } from './ports.js';

export interface Projection {
  sessions(): SessionState[];
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
  };
}

/** Folds the UI slice back onto an overlay read moments earlier, so fields the client
 *  never sees — the tmux name map, dockview's layout blob — survive the write. */
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
    },
  };
}

export function createProjection(store: StorePort): Projection {
  let state = initialState;
  let ui = toUiState(store.read());
  const listeners = new Set<(deltas: Delta[]) => void>();
  const uiListeners = new Set<(uiState: UiState) => void>();

  return {
    sessions: () => Object.values(state.sessions),
    uiState: () => ui,

    dispatch(event) {
      const prev = state;
      state = reduce(state, event);
      const deltas = diff(prev, state);
      if (deltas.length === 0) return;
      for (const listener of [...listeners]) listener(deltas);
    },

    updateUiState(patch) {
      const base = store.read();
      ui = { ...toUiState(base), ...patch };
      store.write(toOverlay(base, ui));
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
