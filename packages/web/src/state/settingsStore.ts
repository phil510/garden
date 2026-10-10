import { create } from 'zustand';

/** Config values the client needs at render time, loaded from `GET /settings` on startup. The
 *  initial values are what the app uses until that arrives, or if it fails. */
interface SettingsStore {
  deadSessionCap: number;
  setSettings: (settings: { deadSessionCap: number }) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  deadSessionCap: 10,
  setSettings: ({ deadSessionCap }) => set({ deadSessionCap }),
}));
