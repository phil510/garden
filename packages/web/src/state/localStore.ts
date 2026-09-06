import { create } from 'zustand';

interface LocalStore {
  /** Keyed by whatever id the caller scrolls — a pane, a tree, a list. */
  scrollOffsets: Record<string, number>;
  setScrollOffset: (key: string, offset: number) => void;
  /** Expanded directory paths per session, since each session's file tree is rooted at its
   *  own cwd. */
  expandedPaths: Record<string, readonly string[]>;
  toggleExpandedPath: (sessionId: string, path: string) => void;
}

export const useLocalStore = create<LocalStore>((set) => ({
  scrollOffsets: {},
  setScrollOffset: (key, offset) =>
    set((state) => ({ scrollOffsets: { ...state.scrollOffsets, [key]: offset } })),
  expandedPaths: {},
  toggleExpandedPath: (sessionId, path) =>
    set((state) => {
      const current = state.expandedPaths[sessionId] ?? [];
      const next = current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path];
      return { expandedPaths: { ...state.expandedPaths, [sessionId]: next } };
    }),
}));
