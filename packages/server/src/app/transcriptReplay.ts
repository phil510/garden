import type { GardenEvent } from '../domain/types.js';
import { createLimiter } from './limiter.js';
import type { TranscriptPort } from './ports.js';
import type { Projection } from './projection.js';

/** Bounds how many transcripts boot has open at once, so a large corpus doesn't exhaust file
 *  descriptors while the reads still overlap. */
const MAX_CONCURRENT_TRANSCRIPT_READS = 8;

/** The slice of `adapters/logger.ts`'s `Logger` the replay needs. */
interface ReplayLogger {
  warn(message: string): void;
  error(message: string): void;
}

type LiveEvent = Extract<GardenEvent, { type: 'transcript-changed' }>;

export interface TranscriptReplay {
  /** The watcher's callback: dispatches straight through once the replay has landed, and holds
   *  events until then. */
  live(event: LiveEvent): void;
  /** Reads every transcript and dispatches them as one `transcripts-replayed`, then releases
   *  the events held meanwhile. */
  run(): Promise<void>;
}

/**
 * The batch is dispatched after every read, so a live write to a file mid-replay would be
 * overwritten by that file's older record in the batch and stay stale until it is written again.
 * Holding live events until the batch lands, then dispatching them in order, keeps the newer
 * record last.
 */
export function createTranscriptReplay(
  deps: { projection: Pick<Projection, 'dispatch'>; transcripts: TranscriptPort },
  logger: ReplayLogger,
): TranscriptReplay {
  const { projection, transcripts } = deps;
  let held: LiveEvent[] | null = [];

  return {
    live(event) {
      if (held === null) projection.dispatch(event);
      else held.push(event);
    },
    async run() {
      try {
        const paths = await transcripts.listFiles();
        const limit = createLimiter(MAX_CONCURRENT_TRANSCRIPT_READS);
        // Indexed by listing position rather than pushed on completion: reads finish out of
        // order, and records for one session resolve last-non-null-wins.
        const reads = await Promise.all(
          paths.map((path) =>
            limit(async () => {
              try {
                const { record, skipped } = await transcripts.readRecord(path);
                if (skipped > 0) {
                  logger.warn(`skipped ${String(skipped)} unparseable line(s) in ${path}`);
                }
                return record;
              } catch (error) {
                // One unreadable transcript is a session garden cannot describe, not a failed boot.
                logger.error(`failed to read transcript ${path}: ${(error as Error).message}`);
                return null;
              }
            }),
          ),
        );
        projection.dispatch({
          type: 'transcripts-replayed',
          records: reads.filter((record) => record !== null),
        });
      } finally {
        const queued = held ?? [];
        held = null;
        for (const event of queued) projection.dispatch(event);
      }
    },
  };
}
