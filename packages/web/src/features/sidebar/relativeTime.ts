const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Coarse "Nm ago" style display for a row's last-activity column. A session whose transcript
 * carries no timestamped line reports `0`, which is an absent reading rather than the epoch.
 */
export function formatRelativeTime(lastActivity: number, now: number): string {
  if (lastActivity === 0) return 'no activity yet';
  const elapsed = Math.max(0, now - lastActivity);
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}
