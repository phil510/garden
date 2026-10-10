import { create } from 'zustand';

/** Config values the client needs at render time, loaded from `GET /settings` before the first
 *  render. The initial values are what the app uses if that fetch fails. */
interface SettingsStore {
  deadSessionCap: number;
  setSettings: (settings: { deadSessionCap: number }) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  deadSessionCap: 10,
  setSettings: ({ deadSessionCap }) => set({ deadSessionCap }),
}));
