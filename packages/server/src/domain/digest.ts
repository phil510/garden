import type { WatchKind, WatchStatus } from '@garden/shared';
import { emptyCursor, emptyTally, readCursor } from './pollCursor.js';
import type { Activity, Cursor, Observation, Tally } from './pollCursor.js';
import type { Watch } from './watches.js';

export interface DigestSettings {
  readonly ignoreAuthors: readonly string[];
  readonly quietWindowMs: number;
}

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

const addTallies = (a: Tally, b: Tally): Tally => ({
  reviews: a.reviews + b.reviews,
  reviewAuthors: union(a.reviewAuthors, b.reviewAuthors),
  comments: a.comments + b.comments,
  checksFailed: union(a.checksFailed, b.checksFailed),
  checksPassed: union(a.checksPassed, b.checksPassed),
  conflict: a.conflict || b.conflict,
  lastActivityAt: Math.max(a.lastActivityAt, b.lastActivityAt),
});

const isEmpty = (t: Tally) =>
  t.reviews === 0 &&
  t.comments === 0 &&
  t.checksFailed.length === 0 &&
  t.checksPassed.length === 0 &&
  !t.conflict;

/** The part of `activity` this watch wants: its kinds decide what counts, `ignoreAuthors` drops
 *  people, and a review with neither a body nor inline comments (a bare approval or the shell of
 *  a comment-only review) says nothing. */
function tallyActivity(
  activity: Activity,
  kinds: readonly WatchKind[],
  ignoreAuthors: readonly string[],
  now: number,
): Tally {
  const ignored = new Set(ignoreAuthors.map((author) => author.toLowerCase()));
  const wanted = (login: string) => !ignored.has(login.toLowerCase());
  let tally = emptyTally();
  const at = (ms: number) => Math.max(tally.lastActivityAt, ms);
  if (kinds.includes('review')) {
    for (const review of activity.reviews) {
      if (!wanted(review.login) || (!review.hasBody && !review.hasInlineComments)) continue;
      tally = {
        ...tally,
        reviews: tally.reviews + 1,
        reviewAuthors: union(tally.reviewAuthors, [review.login]),
        lastActivityAt: at(review.at),
      };
    }
  }
  if (kinds.includes('comment')) {
    for (const comment of activity.comments) {
      if (!wanted(comment.login)) continue;
      tally = { ...tally, comments: tally.comments + 1, lastActivityAt: at(comment.at) };
    }
  }
  for (const check of activity.checks) {
    if (check.outcome === 'failed' && kinds.includes('checks'))
      tally = {
        ...tally,
        checksFailed: union(tally.checksFailed, [check.name]),
        lastActivityAt: at(check.at),
      };
    if (check.outcome === 'passed' && kinds.includes('checks:all'))
      tally = {
        ...tally,
        checksPassed: union(tally.checksPassed, [check.name]),
        lastActivityAt: at(check.at),
      };
  }
  // GitHub gives a conflict no timestamp of its own, so its quiet window starts when it is seen.
  if (activity.conflict && kinds.includes('conflict'))
    tally = { ...tally, conflict: true, lastActivityAt: at(now) };
  return tally;
}

const plural = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

/** `#241 helloextend/foo: 2 reviews (coderabbitai[bot], alice), 3 comments, checks failed: build` */
export function formatDigestLine(
  repo: string,
  pr: number,
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
  return `#${String(pr)} ${repo}: ${parts.join(', ')}`;
}

/**
 * Folds one observation into the watch as it stands now. The caller runs this inside the watch
 * writer, never against a copy taken before the fetch, so an acknowledgement that landed
 * mid-fetch is already visible here.
 *
 * `cursor.written` is what the pending digest already says. A digest that is gone (acknowledged
 * or expired) or has been replaced no longer has anything to fold into, so the next digest
 * counts only what came after. Every change to the line mints a new id and a fresh `createdAt`;
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
  const delivered = pending === null || pending.id !== previous.digestId;
  let written = delivered ? emptyTally() : previous.written;
  let digestId = delivered ? null : previous.digestId;
  let fresh = addTallies(
    previous.fresh,
    tallyActivity(observation.activity, watch.kinds, settings.ignoreAuthors, now),
  );
  let pendingDigest = pending;
  let status: WatchStatus = watch.status === 'error' ? 'active' : watch.status;

  const { closed } = observation.activity;
  const quiet = !isEmpty(fresh) && now - fresh.lastActivityAt >= settings.quietWindowMs;
  if (closed !== null || quiet) {
    written = addTallies(written, fresh);
    fresh = emptyTally();
    const id = mintId();
    pendingDigest = {
      id,
      line: formatDigestLine(watch.repo, watch.pr, written, closed),
      createdAt: now,
    };
    digestId = id;
    if (closed !== null) status = 'closed';
  }

  const cursor: Cursor = { ...observation.tracking, written, fresh, digestId };
  const unchanged =
    watch.cursor !== null &&
    JSON.stringify(cursor) === JSON.stringify(previous) &&
    pendingDigest === pending &&
    status === watch.status;
  return unchanged ? watch : { ...watch, cursor, pendingDigest, status };
}

/** The repo or `gh` is unreachable. Digest state is left alone so recovery loses nothing. */
export function markWatchError(watch: Watch): Watch {
  return watch.status === 'active' ? { ...watch, status: 'error' } : watch;
}
