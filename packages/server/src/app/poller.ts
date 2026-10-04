import {
  checkTransitions,
  conflictTransition,
  emptyCursor,
  newListItems,
  statusTransitions,
} from '../domain/pollCursor.js';
import type { Activity, Cursor, ListCursor, Observation, Tracking } from '../domain/pollCursor.js';
import {
  parseCheckRuns,
  parseIssueComments,
  parsePr,
  parseReviewComments,
  parseReviews,
  parseStatuses,
} from '../domain/github.js';
import type { GhResult, ParsedPage } from '../domain/github.js';
import type { Watch } from '../domain/watches.js';
import { applyObservation, markWatchError } from '../domain/digest.js';
import type { DigestSettings } from '../domain/digest.js';
import { readCursor } from '../domain/pollCursor.js';
import type { ConfigPort, GhPort } from './ports.js';
import { updateWatches } from './watches.js';
import type { WatchesDeps } from './watches.js';

/** A fetch that did not reach a verdict about the PR. */
export type WatchFailure = Exclude<GhResult, { kind: 'ok' } | { kind: 'not-modified' }>;

export type FetchOutcome =
  { readonly kind: 'observed'; readonly observation: Observation } | WatchFailure;

const PAGE_SIZE = 100;

const isFailure = (result: GhResult): result is WatchFailure =>
  result.kind !== 'ok' && result.kind !== 'not-modified';

/** Every page of a list endpoint, each with the ETag it had last time. An unchanged page comes
 *  back 304 with no items, which is correct: nothing on it is new. Paging continues while a page
 *  is full; an unchanged page counts as full when the cursor holds a later page's ETag. */
async function fetchPages<T>(
  gh: GhPort,
  path: string,
  previous: readonly string[],
  parse: (body: unknown) => ParsedPage<T>,
): Promise<{ etags: string[]; items: T[] } | WatchFailure> {
  const etags: string[] = [];
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const sent = previous[page - 1] ?? '';
    const result = await gh.get(
      `${path}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
      sent === '' ? null : sent,
    );
    if (isFailure(result)) return result;
    let full: boolean;
    if (result.kind === 'not-modified') {
      etags.push(sent);
      full = previous.length > page;
    } else {
      const parsed = parse(result.body);
      etags.push(result.etag ?? '');
      items.push(...parsed.items);
      full = parsed.count >= PAGE_SIZE;
    }
    if (!full) return { etags, items };
  }
}

/**
 * Reads what changed on one watch's PR since `cursor` (null on the first poll) and the cursor
 * tracking to adopt. Writes nothing: the result is merged inside the watch writer. Stops at the
 * first call that is not a normal answer and returns it as the failure.
 *
 * The three lists are read even when the PR has closed, so a review that landed just before the
 * merge reaches the final digest. Check runs and statuses are read only for an open PR.
 */
export async function fetchWatch(
  gh: GhPort,
  watch: Watch,
  cursor: Cursor | null,
): Promise<FetchOutcome> {
  const previous = cursor ?? emptyCursor();
  const firstPoll = cursor === null;
  const base = `repos/${watch.repo}`;
  const prPath = `${base}/pulls/${String(watch.pr)}`;

  const prResult = await gh.get(prPath, previous.pr.etag);
  if (isFailure(prResult)) return prResult;
  let pr = previous.pr;
  if (prResult.kind === 'ok') {
    const fact = parsePr(prResult.body);
    if (fact === null) throw new Error(`${prPath}: unexpected PR response`);
    pr = { etag: prResult.etag, ...fact };
  }

  const reviews = await fetchPages(gh, `${prPath}/reviews`, previous.reviews.etags, parseReviews);
  if (!('items' in reviews)) return reviews;
  const issueComments = await fetchPages(
    gh,
    `${base}/issues/${String(watch.pr)}/comments`,
    previous.issueComments.etags,
    parseIssueComments,
  );
  if (!('items' in issueComments)) return issueComments;
  const reviewComments = await fetchPages(
    gh,
    `${prPath}/comments`,
    previous.reviewComments.etags,
    parseReviewComments,
  );
  if (!('items' in reviewComments)) return reviewComments;

  const submittedAt = new Map(reviews.items.map((review) => [review.id, review.submittedAt]));
  // An inline comment is visible from the later of its own creation and its review's submission:
  // a comment inside a pending review is created when the review starts, a reply long after it.
  const reviewCommentAt = (comment: { createdAt: number; reviewId: number | null }) =>
    Math.max(
      comment.createdAt,
      (comment.reviewId === null ? undefined : submittedAt.get(comment.reviewId)) ?? 0,
    );
  const newReviews = newListItems(
    reviews.items,
    previous.reviews.seen,
    firstPoll,
    watch.createdAt,
    (r) => r.submittedAt,
  );
  const newIssueComments = newListItems(
    issueComments.items,
    previous.issueComments.seen,
    firstPoll,
    watch.createdAt,
    (c) => c.createdAt,
  );
  const newReviewComments = newListItems(
    reviewComments.items,
    previous.reviewComments.seen,
    firstPoll,
    watch.createdAt,
    reviewCommentAt,
  );

  let checkRuns = previous.checkRuns;
  let status = previous.status;
  const checks: Activity['checks'][number][] = [];
  if (pr.open) {
    const sameSha = previous.checkRuns.sha === pr.headSha;
    const runs = await fetchPages(
      gh,
      `${base}/commits/${pr.headSha ?? ''}/check-runs`,
      sameSha ? previous.checkRuns.etags : [],
      parseCheckRuns,
    );
    if (!('items' in runs)) return runs;
    const transitions = checkTransitions(
      runs.items,
      sameSha ? previous.checkRuns.reported : {},
      watch.createdAt,
    );
    checks.push(...transitions.transitions);
    checkRuns = { sha: pr.headSha, etags: runs.etags, reported: transitions.reported };

    const sameStatusSha = previous.status.sha === pr.headSha;
    const statusPath = `${base}/commits/${pr.headSha ?? ''}/status?per_page=${String(PAGE_SIZE)}`;
    const statusResult = await gh.get(statusPath, sameStatusSha ? previous.status.etag : null);
    if (isFailure(statusResult)) return statusResult;
    status = {
      sha: pr.headSha,
      etag: sameStatusSha ? previous.status.etag : null,
      reported: sameStatusSha ? previous.status.reported : {},
    };
    if (statusResult.kind === 'ok') {
      const transitions = statusTransitions(
        parseStatuses(statusResult.body).items,
        status.reported,
        watch.createdAt,
      );
      checks.push(...transitions.transitions);
      status = { sha: pr.headSha, etag: statusResult.etag, reported: transitions.reported };
    }
  }

  // A closed PR's mergeability says nothing about conflicts, so it is carried over untouched.
  const conflict = pr.open
    ? conflictTransition(previous.pr.mergeable, pr.mergeable)
    : { fires: false, next: previous.pr.mergeable };
  pr = { ...pr, mergeable: conflict.next };

  const listCursor = (etags: readonly string[], seen: readonly number[]): ListCursor => ({
    etags,
    seen,
  });
  const tracking: Tracking = {
    v: 1,
    pr,
    reviews: listCursor(reviews.etags, newReviews.seen),
    issueComments: listCursor(issueComments.etags, newIssueComments.seen),
    reviewComments: listCursor(reviewComments.etags, newReviewComments.seen),
    checkRuns,
    status,
  };
  const activity: Activity = {
    reviews: newReviews.fresh.map((review) => ({
      login: review.login,
      at: review.submittedAt,
      hasBody: review.hasBody,
      hasInlineComments: newReviewComments.fresh.some((comment) => comment.reviewId === review.id),
    })),
    comments: [
      ...newIssueComments.fresh.map((c) => ({ login: c.login, at: c.createdAt })),
      ...newReviewComments.fresh.map((c) => ({ login: c.login, at: reviewCommentAt(c) })),
    ],
    checks,
    conflict: conflict.fires,
    closed: pr.open ? null : { merged: pr.merged },
  };
  return { kind: 'observed', observation: { activity, tracking } };
}

/** The slice of `adapters/logger.ts`'s `Logger` the poller needs. */
export interface PollerLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface PollerDeps {
  readonly watches: WatchesDeps;
  readonly gh: GhPort;
  /** `ignoreAuthors`, `quietWindowMinutes` and `pollIntervalMinutes` are read at use time, so a
   *  settings change applies from the next tick. */
  readonly config: Pick<ConfigPort, 'read'>;
  readonly logger: PollerLogger;
  readonly now: () => number;
  readonly mintId: () => string;
}

export interface Poller {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

const MINUTE_MS = 60_000;

/** Applies `change` to the watches in `ids`. Returns `watches` itself when none of them is
 *  still present or changed, so the writer sees no change and skips the store write. */
function changeWatches(
  watches: readonly Watch[],
  ids: ReadonlySet<string>,
  change: (watch: Watch) => Watch,
): readonly Watch[] {
  let changed = false;
  const next = watches.map((watch) => {
    if (!ids.has(watch.id)) return watch;
    const result = change(watch);
    if (result !== watch) changed = true;
    return result;
  });
  return changed ? next : watches;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * One loop over every watch that is not closed. Each tick fetches a watch (no writes), then
 * merges the observation inside the watch writer against the watch as it is by then, so an
 * acknowledgement or removal that landed during the fetch is respected. The tick also runs the
 * writer once with no change, which is what prunes expired watches.
 *
 * A missing or logged-out `gh` marks every polled watch as error and ends the tick; a 403/404
 * marks only that watch. Both clear on the next successful observation. A rate limit holds the
 * whole loop until its resume time and is not an error status. Any other failure (a timeout, a
 * garbled response) is logged and leaves the watch as it was.
 */
export function createPoller(deps: PollerDeps): Poller {
  let inFlight = false;
  let started = false;
  let stopped = false;
  let holdUntil = 0;
  let timer: NodeJS.Timeout | undefined;

  async function pollWatches(): Promise<void> {
    const settings = deps.config.read();
    const digestSettings = {
      ignoreAuthors: settings.ignoreAuthors,
      quietWindowMs: settings.quietWindowMinutes * MINUTE_MS,
    };
    // A write that changes nothing but prune expired watches.
    updateWatches(deps.watches, (current) => current, deps.now());
    const { watches } = deps.watches.projection.overlay();
    if (deps.now() < holdUntil) return;
    const polled = watches.filter((w) => w.status !== 'closed');
    for (const watch of polled) {
      if (stopped) return;
      try {
        if (await pollOne(watch, polled, digestSettings)) return;
      } catch (error) {
        // One watch failing must not starve the rest of the tick.
        deps.logger.error(`poll ${watch.repo}#${String(watch.pr)} failed: ${describe(error)}`);
      }
    }
  }

  /** Fetches and merges one watch; true when the tick should end. */
  async function pollOne(
    watch: Watch,
    polled: readonly Watch[],
    digestSettings: DigestSettings,
  ): Promise<boolean> {
    const cursor = readCursor(watch.cursor);
    if (watch.cursor !== null && cursor === null)
      deps.logger.warn(`watch ${watch.id}: unreadable poll cursor, starting over from creation`);
    const outcome = await fetchWatch(deps.gh, watch, cursor);
    if (stopped) return true;
    const now = deps.now();
    switch (outcome.kind) {
      case 'observed':
        updateWatches(
          deps.watches,
          (current) =>
            changeWatches(current, new Set([watch.id]), (w) =>
              applyObservation(w, outcome.observation, digestSettings, now, deps.mintId),
            ),
          now,
        );
        return false;
      case 'inaccessible':
        updateWatches(
          deps.watches,
          (current) => changeWatches(current, new Set([watch.id]), markWatchError),
          now,
        );
        return false;
      case 'unavailable': {
        deps.logger.warn(`gh is unavailable (${outcome.reason}); marking watches as error`);
        const ids = new Set(polled.map((w) => w.id));
        updateWatches(deps.watches, (current) => changeWatches(current, ids, markWatchError), now);
        return true;
      }
      case 'rate-limited':
        holdUntil = outcome.resumeAt;
        deps.logger.warn(
          `GitHub rate limit; pausing polls until ${new Date(holdUntil).toISOString()}`,
        );
        return true;
    }
  }

  async function tick(): Promise<void> {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      await pollWatches();
    } finally {
      inFlight = false;
    }
  }

  function loop(): void {
    tick()
      .catch((error: unknown) => {
        deps.logger.error(`watch poll failed: ${describe(error)}`);
      })
      .finally(() => {
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
