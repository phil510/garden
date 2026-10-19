import type { Alert } from '@garden/shared';
import type { OverlayState } from './overlay.js';

/** Raising again replaces the text and keeps the original `raisedAt`; alerts never accumulate. */
export function raiseAlert(prev: Alert | null, text: string, now: number): Alert {
  return { text, raisedAt: prev?.raisedAt ?? now, updatedAt: now };
}

/** Returns the same object when the session has no alert, so `updateOverlay` skips the write. */
export function withoutAlert(overlay: OverlayState, sessionId: string): OverlayState {
  if (!overlay.alerts.some((a) => a.sessionId === sessionId)) return overlay;
  return { ...overlay, alerts: overlay.alerts.filter((a) => a.sessionId !== sessionId) };
}
