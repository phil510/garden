import type { HarnessPort } from './ports.js';
import type { Projection } from './projection.js';

export function createSessionMetadataRefresh(
  projection: Pick<Projection, 'dispatch'>,
  harness: Pick<HarnessPort, 'readSessionMetadata'>,
  logger: { warn(message: string): void; error(message: string): void },
): () => Promise<void> {
  let reading = false;
  return async () => {
    // Only one scan can publish at a time, so an older read cannot restore retired metadata.
    if (reading) return;
    reading = true;
    try {
      const { names, nativeTitles, skipped } = await harness
        .readSessionMetadata()
        .catch((error: unknown) => {
          logger.error(
            `session registry read failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return { names: {}, nativeTitles: {}, skipped: 0 };
        });
      if (skipped > 0)
        logger.warn(`skipped ${String(skipped)} unreadable harness registry file(s)`);
      projection.dispatch({
        type: 'session-metadata-loaded',
        names,
        nativeTitles: nativeTitles ?? {},
      });
    } finally {
      reading = false;
    }
  };
}
