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
import type { GhPort } from './ports.js';

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
  const reviewCommentAt = (comment: { createdAt: number; reviewId: number | null }) =>
    (comment.reviewId === null ? undefined : submittedAt.get(comment.reviewId)) ??
    comment.createdAt;
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

  const conflict = conflictTransition(previous.pr.mergeable, pr.mergeable);
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
