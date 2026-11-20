import type { SettingsResponse } from '@garden/shared'
import { create } from 'zustand'

/** Config values the client needs at render time, loaded from `GET /settings` on startup. The
 *  initial values are what the app uses until that arrives, or if it fails. */
interface SettingsStore {
  deadSessionCap: number
  harness: SettingsResponse['harness'] | undefined
  setSettings: (settings: Pick<SettingsResponse, 'deadSessionCap' | 'harness'>) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  deadSessionCap: 10,
  harness: undefined,
  setSettings: ({ deadSessionCap, harness }) => set({ deadSessionCap, harness }),
}))
