import { create } from 'zustand';

/** Transient, per-browser, not persisted — one current toast, not a queue, since nothing in
 *  this codebase yet needs more than that (mirrors state/localStore.ts's idiom for this kind
 *  of UI state). */
interface ToastStore {
  message: string | null;
  showToast: (message: string) => void;
  clearToast: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  showToast: (message) => set({ message }),
  clearToast: () => set({ message: null }),
}));
