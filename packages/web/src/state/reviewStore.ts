import type { ReviewQueue } from '@garden/shared';
import { create } from 'zustand';

interface ReviewStore {
  /** Null until the first snapshot arrives. */
  queue: ReviewQueue | null;
  setQueue: (queue: ReviewQueue) => void;
}

export const useReviewStore = create<ReviewStore>((set) => ({
  queue: null,
  setQueue: (queue) => set({ queue }),
}));
