import { reviewPollOutcome } from '../domain/reviews.js';
import type { PollerLogger } from './poller.js';
import type { ConfigPort, GhPort } from './ports.js';
import type { CloneResolver } from './reviewClones.js';
import type { ReviewStore } from './reviews.js';

/** Search takes the whole query in the URL, and the adapter passes the path to `gh api`
 *  verbatim, so the encoding is ours. */
export const REVIEW_SEARCH_PATH = `search/issues?q=${encodeURIComponent(
  'is:open is:pr user-review-requested:@me',
)}&per_page=100`;

export interface ReviewPollerDeps {
  readonly gh: GhPort;
  readonly store: Pick<ReviewStore, 'complete' | 'fail'>;
  readonly clones: CloneResolver;
  /** `pollIntervalMinutes` is read after every tick, so a settings change applies from the next. */
  readonly config: Pick<ConfigPort, 'read'>;
  readonly logger: PollerLogger;
  readonly now: () => number;
}

export interface ReviewPoller {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

const MINUTE_MS = 60_000;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Keeps the review queue current with one search per tick. It is a loop of its own, beside the
 * watch poller's rather than a step in it: that tick ends early on a rate limit or an
 * unavailable `gh`, and search has a rate limit separate from the one it holds for. A failure
 * keeps the previous items and sets the store's fault; a rate limit also holds the loop, with no
 * calls, until its resume time. `tick` never rejects.
 */
export function createReviewPoller(deps: ReviewPollerDeps): ReviewPoller {
  let inFlight = false;
  let started = false;
  let stopped = false;
  let holdUntil = 0;
  let timer: NodeJS.Timeout | undefined;

  async function poll(): Promise<void> {
    if (deps.now() < holdUntil) return;
    try {
      const result = await deps.gh.get(REVIEW_SEARCH_PATH, null);
      if (stopped) return;
      if (result.kind === 'rate-limited') {
        holdUntil = result.resumeAt;
        deps.logger.warn(
          `GitHub search rate limit; pausing review polls until ${new Date(holdUntil).toISOString()}`,
        );
      }
      const outcome = reviewPollOutcome(result);
      if (outcome.kind === 'complete') {
        const clones = await deps.clones.resolve([...new Set(outcome.items.map((i) => i.repo))]);
        if (stopped) return;
        const items = outcome.items.map((item) => ({
          ...item,
          clonePath: clones.get(item.repo) ?? null,
        }));
        deps.store.complete(items, new Date(deps.now()).toISOString());
        return;
      }
      if (outcome.fault === 'incomplete' || outcome.fault === 'error')
        deps.logger.warn(`review poll: ${outcome.fault} (${result.kind})`);
      deps.store.fail(outcome.fault);
    } catch (error) {
      deps.logger.error(`review poll failed: ${describe(error)}`);
      deps.store.fail('error');
    }
  }

  async function tick(): Promise<void> {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      await poll();
    } finally {
      inFlight = false;
    }
  }

  function loop(): void {
    void tick().finally(() => {
      if (stopped) return;
      timer = setTimeout(loop, deps.config.read().pollIntervalMinutes * MINUTE_MS);
    });
  }

  return {
    tick,
    start() {
      if (started || stopped) return;
      started = true;
      loop();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
