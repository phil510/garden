import { create } from 'zustand';

/** Transient, per-browser, not persisted — one current toast, not a queue, since nothing in
 *  this codebase yet needs more than that (mirrors state/localStore.ts's idiom for this kind
 *  of UI state). `token` increments on every `showToast` call, including a repeat of the same
 *  message — `Toast.tsx`'s auto-dismiss effect depends on it so a second identical failure
 *  restarts the dismiss timer instead of inheriting the first one's deadline. */
interface ToastStore {
  message: string | null;
  token: number;
  showToast: (message: string) => void;
  clearToast: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  token: 0,
  showToast: (message) => set((state) => ({ message, token: state.token + 1 })),
  clearToast: () => set({ message: null }),
}));
