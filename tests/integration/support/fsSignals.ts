import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FS_CHANGE_DEBOUNCE_MS } from '../../../packages/server/src/adapters/fsWatch.js';
import { until } from './poll.js';

/** Long enough for a trailing debounce to fire and for a stray second signal to show up. */
export const QUIET_WINDOW_MS = 3 * FS_CHANGE_DEBOUNCE_MS;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until a watch on `dir` is live and its setup noise has drained: writes one probe
 * file, waits for its signal, then the quiet window. Writes once, because a write every poll
 * would keep restarting the trailing debounce. FSEvents on macOS can miss the first write
 * after a watch starts, so it re-writes the probe when nothing arrived; Linux arms
 * synchronously and never needs that.
 */
export async function settle(dir: string, count: () => number): Promise<void> {
  const probe = join(dir, `.probe-${String(Date.now())}`);
  const before = count();
  writeFileSync(probe, '0');
  let retries = 0;
  const deadline = Date.now() + 10_000;
  let nextRetry = Date.now() + 3 * FS_CHANGE_DEBOUNCE_MS;
  await until(
    'the probe write to signal',
    async () => {
      await Promise.resolve();
      if (process.platform === 'darwin' && count() === before && Date.now() >= nextRetry) {
        retries += 1;
        writeFileSync(probe, String(retries));
        nextRetry = Date.now() + 3 * FS_CHANGE_DEBOUNCE_MS;
      }
      return count();
    },
    (current) => current > before,
    Math.max(1, deadline - Date.now()),
  );
  await sleep(QUIET_WINDOW_MS);
}
