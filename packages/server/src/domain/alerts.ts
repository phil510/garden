import type { Alert } from '@garden/shared';

/** Raising again replaces the text and keeps the original `raisedAt`; alerts never accumulate. */
export function raiseAlert(prev: Alert | null, text: string, now: number): Alert {
  return { text, raisedAt: prev?.raisedAt ?? now, updatedAt: now };
}
