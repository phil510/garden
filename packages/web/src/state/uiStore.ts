import type { UiState } from '@garden/shared';
import { create } from 'zustand';

interface UiStore {
  uiState: UiState;
  /** The server owns this state; every call mirrors a `snapshot` or `ui-state` message
   *  arriving over `WS /events`, never a local change made ahead of the server's own. */
  setUiState: (uiState: UiState) => void;
}

const initialUiState: UiState = {
  hideDead: false,
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
  preset: 'single',
  slots: [],
  focusedSlot: 0,
};

export const useUiStore = create<UiStore>((set) => ({
  uiState: initialUiState,
  setUiState: (uiState) => set({ uiState }),
}));
