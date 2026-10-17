import type { DigestDetail, DigestItems, WatchKind, WatchStatus } from '@garden/shared';
import { emptyCursor, emptyItems, emptyTally, isEmptyTally, readCursor } from './pollCursor.js';
import type { Activity, Cursor, Observation, Tally, Tracking } from './pollCursor.js';
import type { Watch } from './watches.js';

export interface DigestSettings {
  readonly ignoreAuthors: readonly string[];
  readonly quietWindowMs: number;
}

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

const addItems = (a: DigestItems | null, b: DigestItems | null): DigestItems | null =>
  a === null || b === null
    ? null
    : {
        reviews: [...a.reviews, ...b.reviews],
        issueComments: [...a.issueComments, ...b.issueComments],
        reviewComments: [...a.reviewComments, ...b.reviewComments],
        checkRuns: [...a.checkRuns, ...b.checkRuns],
        statuses: [...a.statuses, ...b.statuses],
        conflicts: [...a.conflicts, ...b.conflicts],
      };

const addTallies = (a: Tally, b: Tally): Tally => ({
  reviews: a.reviews + b.reviews,
  reviewAuthors: union(a.reviewAuthors, b.reviewAuthors),
  comments: a.comments + b.comments,
  checksFailed: union(a.checksFailed, b.checksFailed),
  checksPassed: union(a.checksPassed, b.checksPassed),
  conflict: a.conflict || b.conflict,
  lastActivityAt: Math.max(a.lastActivityAt, b.lastActivityAt),
  items: addItems(a.items, b.items),
});

const iso = (ms: number) => new Date(ms).toISOString();

/** The part of `activity` this watch wants: its kinds decide what counts, `ignoreAuthors` drops
 *  people, `ignoredChecks` drops checks by exact name. Each item is recorded in the same branch that counts it, so the detail and the line
 *  cannot disagree. */
function tallyActivity(
  activity: Activity,
  kinds: readonly WatchKind[],
  ignoreAuthors: readonly string[],
  ignoredChecks: readonly string[],
  now: number,
): Tally {
  const ignored = new Set(ignoreAuthors.map((author) => author.toLowerCase()));
  const wanted = (login: string) => !ignored.has(login.toLowerCase());
  const items = emptyItems();
  let tally = emptyTally();
  const at = (ms: number) => Math.max(tally.lastActivityAt, ms);
  if (kinds.includes('review')) {
    for (const review of activity.reviews) {
      if (!wanted(review.login)) continue;
      items.reviews.push({
        id: review.id,
        author: review.login,
        state: review.state,
        submittedAt: iso(review.at),
      });
      tally = {
        ...tally,
        reviews: tally.reviews + 1,
        reviewAuthors: union(tally.reviewAuthors, [review.login]),
        lastActivityAt: at(review.at),
      };
    }
  }
  if (kinds.includes('comment')) {
    for (const comment of activity.issueComments) {
      if (!wanted(comment.login)) continue;
      items.issueComments.push({ id: comment.id, author: comment.login, at: iso(comment.at) });
      tally = { ...tally, comments: tally.comments + 1, lastActivityAt: at(comment.at) };
    }
    for (const comment of activity.reviewComments) {
      if (!wanted(comment.login)) continue;
      items.reviewComments.push({
        id: comment.id,
        author: comment.login,
        reviewId: comment.reviewId,
        at: iso(comment.at),
      });
      tally = { ...tally, comments: tally.comments + 1, lastActivityAt: at(comment.at) };
    }
  }
  const mutedChecks = new Set(ignoredChecks);
  for (const check of activity.checks) {
    if (mutedChecks.has(check.name)) continue;
    const reported =
      (check.outcome === 'failed' && kinds.includes('checks')) ||
      (check.outcome === 'passed' && kinds.includes('checks:all'));
    if (!reported) continue;
    if (check.kind === 'check-run')
      items.checkRuns.push({
        id: check.id,
        name: check.name,
        conclusion: check.conclusion,
        outcome: check.outcome,
        completedAt: iso(check.at),
        headSha: check.headSha,
      });
    else
      items.statuses.push({
        context: check.name,
        state: check.state,
        outcome: check.outcome,
        updatedAt: iso(check.at),
        headSha: check.headSha,
      });
    tally =
      check.outcome === 'failed'
        ? {
            ...tally,
            checksFailed: union(tally.checksFailed, [check.name]),
            lastActivityAt: at(check.at),
          }
        : {
            ...tally,
            checksPassed: union(tally.checksPassed, [check.name]),
            lastActivityAt: at(check.at),
          };
  }
  // GitHub gives a conflict no timestamp of its own, so its quiet window starts when it is seen.
  if (activity.conflict !== null && kinds.includes('conflict')) {
    items.conflicts.push({ headSha: activity.conflict.headSha, seenAt: iso(now) });
    tally = { ...tally, conflict: true, lastActivityAt: at(now) };
  }
  return { ...tally, items };
}

const plural = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

/** `#241 helloextend/foo: [digest 3f9a2c7b01de] 2 reviews (coderabbitai[bot], alice), 3 comments,
 *  checks failed: build`. The id sits after the colon so the line still starts with the PR and
 *  ends with `merged` or `closed`. */
export function formatDigestLine(
  repo: string,
  pr: number,
  id: string,
  tally: Tally,
  closed: { readonly merged: boolean } | null,
): string {
  const parts: string[] = [];
  if (tally.reviews > 0)
    parts.push(`${plural(tally.reviews, 'review')} (${tally.reviewAuthors.join(', ')})`);
  if (tally.comments > 0) parts.push(plural(tally.comments, 'comment'));
  if (tally.checksFailed.length > 0) parts.push(`checks failed: ${tally.checksFailed.join(', ')}`);
  if (tally.checksPassed.length > 0) parts.push(`checks passed: ${tally.checksPassed.join(', ')}`);
  if (tally.conflict) parts.push('merge conflict');
  if (closed !== null) parts.push(closed.merged ? 'merged' : 'closed');
  return `#${String(pr)} ${repo}: [digest ${id}] ${parts.join(', ')}`;
}

function digestDetail(
  watch: Watch,
  minted: { readonly id: string; readonly line: string; readonly replaces: string | null },
  items: DigestItems,
  pr: Tracking['pr'],
  closed: { readonly merged: boolean } | null,
  now: number,
): DigestDetail {
  return {
    id: minted.id,
    repo: watch.repo,
    pr: watch.pr,
    line: minted.line,
    createdAt: iso(now),
    replaces: minted.replaces,
    atMint: { headSha: pr.headSha, mergeable: pr.mergeable },
    closed: closed === null ? null : { merged: closed.merged },
    items,
  };
}

/**
 * Folds one observation into the watch as it stands now. The caller runs this inside the watch
 * writer, never against a copy taken before the fetch, so an acknowledgement that landed
 * mid-fetch is already visible here.
 *
 * `cursor.written` is what the pending digest already says. A digest that is gone (acknowledged
 * or expired) no longer has anything to fold into, so the next digest counts only what came
 * after. Every change to the line mints a new id and a fresh `createdAt`;
 * the poller never clears a digest. A PR that is no longer open ends the watch with its final
 * digest immediately; otherwise activity waits in `cursor.fresh` until it has been quiet for the
 * window. Returns `watch` itself when nothing changed.
 */
export function applyObservation(
  watch: Watch,
  observation: Observation,
  settings: DigestSettings,
  now: number,
  mintId: () => string,
): Watch {
  if (watch.status === 'closed') return watch;
  const previous = readCursor(watch.cursor) ?? emptyCursor();
  const pending = watch.pendingDigest;
  let written = pending === null ? emptyTally() : previous.written;
  let fresh = addTallies(
    previous.fresh,
    tallyActivity(
      observation.activity,
      watch.kinds,
      settings.ignoreAuthors,
      watch.ignoredChecks ?? [],
      now,
    ),
  );
  let pendingDigest = pending;
  let status: WatchStatus = watch.status === 'error' ? 'active' : watch.status;

  const { closed } = observation.activity;
  const quiet = !isEmptyTally(fresh) && now - fresh.lastActivityAt >= settings.quietWindowMs;
  if (closed !== null || quiet) {
    written = addTallies(written, fresh);
    fresh = emptyTally();
    const id = mintId();
    const line = formatDigestLine(watch.repo, watch.pr, id, written, closed);
    pendingDigest = {
      id,
      line,
      createdAt: now,
      ...(written.items === null
        ? {}
        : {
            detail: digestDetail(
              watch,
              { id, line, replaces: pending?.id ?? null },
              written.items,
              observation.tracking.pr,
              closed,
              now,
            ),
          }),
    };
    if (closed !== null) status = 'closed';
  }

  const cursor: Cursor = { ...observation.tracking, written, fresh };
  const unchanged =
    watch.cursor !== null &&
    JSON.stringify(cursor) === JSON.stringify(previous) &&
    pendingDigest === pending &&
    status === watch.status;
  if (unchanged) return watch;
  // No longer in error, so the reason goes: absent, not undefined, matches a freshly added watch.
  const next: { -readonly [K in keyof Watch]: Watch[K] } = {
    ...watch,
    cursor,
    pendingDigest,
    status,
  };
  delete next.errorReason;
  return next;
}

/** The repo or `gh` is unreachable. Digest state is left alone so recovery loses nothing. A
 *  watch already in error takes the newest reason, since the fix it needs may have changed. */
export function markWatchError(watch: Watch, reason: string): Watch {
  if (watch.status === 'closed') return watch;
  if (watch.status === 'error' && watch.errorReason === reason) return watch;
  return { ...watch, status: 'error', errorReason: reason };
}
