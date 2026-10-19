import { create } from 'zustand';

export type ToastKind = 'success' | 'error';

/** Transient, per-browser, not persisted — one current toast, not a queue, since nothing in
 *  this codebase yet needs more than that (mirrors state/localStore.ts's idiom for this kind
 *  of UI state). Carries command failures and save confirmations; a toast shown without a
 *  kind is an error. `token` increments on every `showToast` call, including a repeat of the
 *  same message — `Toast.tsx`'s auto-dismiss effect depends on it so a second identical toast
 *  restarts the dismiss timer instead of inheriting the first one's deadline. */
interface ToastStore {
  message: string | null;
  kind: ToastKind;
  token: number;
  showToast: (message: string, kind?: ToastKind) => void;
  clearToast: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  kind: 'error',
  token: 0,
  showToast: (message, kind = 'error') =>
    set((state) => ({ message, kind, token: state.token + 1 })),
  clearToast: () => set({ message: null }),
}));
