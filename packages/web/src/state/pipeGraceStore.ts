import { create } from 'zustand';

/** Ids of live, watching sessions whose pipe has been disconnected past the grace period.
 *  Transient and written only by `usePipeGrace`, so the row glyph, hover card, top-bar dot and
 *  watches panel all agree. */
interface PipeGraceStore {
  faulted: ReadonlySet<string>;
  setFaulted: (faulted: ReadonlySet<string>) => void;
}

export const usePipeGraceStore = create<PipeGraceStore>((set) => ({
  faulted: new Set(),
  setFaulted: (faulted) => set({ faulted }),
}));
