import { create } from 'zustand';

/** Ids of sessions whose pane attach the server refused because another window holds it.
 *  Transient and per-browser: written by the terminal registry, read by `StagePane`. */
interface RefusedAttachStore {
  refused: ReadonlySet<string>;
  markRefused: (id: string) => void;
  clearRefused: (id: string) => void;
}

export const useRefusedAttachStore = create<RefusedAttachStore>((set) => ({
  refused: new Set(),
  markRefused: (id) => set((state) => ({ refused: new Set(state.refused).add(id) })),
  clearRefused: (id) =>
    set((state) => {
      if (!state.refused.has(id)) return state;
      const next = new Set(state.refused);
      next.delete(id);
      return { refused: next };
    }),
}));
