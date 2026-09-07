import { applyDelta } from '@garden/shared';
import type { Delta, SessionMap, SessionState } from '@garden/shared';
import { create } from 'zustand';

interface SessionStore {
  sessions: SessionMap;
  /** Replaces the whole map, for the snapshot a fresh `WS /events` connection sends. */
  setSnapshot: (sessions: SessionState[]) => void;
  applyDeltas: (deltas: readonly Delta[]) => void;
}

/** So a snapshot is folded through `applyDelta` too: the map has exactly one writer. */
const snapshotDeltas = (sessions: SessionState[]): Delta[] =>
  sessions.map((session) => ({ type: 'session-added', session }));

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: {},
  setSnapshot: (sessions) => set({ sessions: applyDelta({}, snapshotDeltas(sessions)) }),
  applyDeltas: (deltas) => set((state) => ({ sessions: applyDelta(state.sessions, deltas) })),
}));
