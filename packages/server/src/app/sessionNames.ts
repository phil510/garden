import type { HarnessPort } from './ports.js';
import type { Projection } from './projection.js';

export function createSessionNameRefresh(
  projection: Pick<Projection, 'dispatch'>,
  harness: Pick<HarnessPort, 'readSessionNames'>,
  logger: { warn(message: string): void; error(message: string): void },
): () => Promise<void> {
  let reading = false;
  return async () => {
    // Only one scan can publish at a time, so an older read cannot restore a retired name.
    if (reading) return;
    reading = true;
    try {
      const { names, skipped } = await harness.readSessionNames().catch((error: unknown) => {
        logger.error(
          `session registry read failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return { names: {}, skipped: 0 };
      });
      if (skipped > 0)
        logger.warn(`skipped ${String(skipped)} unreadable harness registry file(s)`);
      projection.dispatch({ type: 'session-names-loaded', names });
    } finally {
      reading = false;
    }
  };
}
