import type { UiState } from '@garden/shared';
import { create } from 'zustand';

interface UiStore {
  uiState: UiState;
  /** False until the server's first `snapshot` lands. The stage will not persist a layout
   *  before then: what it would persist is the placeholder it renders while waiting. */
  hydrated: boolean;
  /** The server owns this state; every call mirrors a `snapshot` or `ui-state` message
   *  arriving over `WS /events`, never a local change made ahead of the server's own. */
  setUiState: (uiState: UiState) => void;
}

const initialUiState: UiState = {
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
  hideDeadRepos: [],
  preset: 'single',
  slots: [],
  focusedSlot: 0,
  layout: null,
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
};

export const useUiStore = create<UiStore>((set) => ({
  uiState: initialUiState,
  hydrated: false,
  setUiState: (uiState) => set({ uiState, hydrated: true }),
}));
