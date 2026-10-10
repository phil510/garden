import { create } from 'zustand';

/** Config values the client needs at render time, loaded from `GET /settings` before the first
 *  render. The initial values are what the app uses if that fetch fails. */
interface SettingsStore {
  deadSessionCap: number;
  terminalFontSize: number;
  setSettings: (settings: { deadSessionCap: number; terminalFontSize: number }) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  deadSessionCap: 10,
  terminalFontSize: 13,
  setSettings: ({ deadSessionCap, terminalFontSize }) => set({ deadSessionCap, terminalFontSize }),
}));
