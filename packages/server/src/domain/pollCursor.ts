import type { CheckRunFact, StatusFact } from './github.js';

/** What has been counted for a digest but not yet delivered. Counts and names only. */
export interface Tally {
  readonly reviews: number;
  readonly reviewAuthors: readonly string[];
  readonly comments: number;
  readonly checksFailed: readonly string[];
  readonly checksPassed: readonly string[];
  readonly conflict: boolean;
  /** Epoch ms of the latest activity counted; 0 while empty. */
  readonly lastActivityAt: number;
}

export interface ListCursor {
  /** One ETag per page requested last time. */
  readonly etags: readonly string[];
  /** Every id already reported or deliberately skipped. */
  readonly seen: readonly number[];
}

/** The poller's progress marker for one watch. It holds ids, ETags, states and counts, never PR
 *  content (no titles, bodies or diffs). */
export interface Cursor {
  readonly v: 1;
  readonly pr: {
    readonly etag: string | null;
    readonly open: boolean;
    readonly merged: boolean;
    readonly mergeable: boolean | null;
    readonly headSha: string | null;
  };
  readonly reviews: ListCursor;
  readonly issueComments: ListCursor;
  readonly reviewComments: ListCursor;
  readonly checkRuns: {
    readonly sha: string | null;
    readonly etags: readonly string[];
    /** `<conclusion>@<completed_at>` by check run id. */
    readonly reported: Readonly<Record<string, string>>;
  };
  readonly status: {
    readonly sha: string | null;
    readonly etag: string | null;
    /** `<state>@<updated_at>` by status context. */
    readonly reported: Readonly<Record<string, string>>;
  };
  /** Activity already in the digest that is pending (or was, until acknowledged). */
  readonly written: Tally;
  /** Activity still inside the quiet window. */
  readonly fresh: Tally;
}

export type Tracking = Omit<Cursor, 'written' | 'fresh'>;

export const emptyTally = (): Tally => ({
  reviews: 0,
  reviewAuthors: [],
  comments: 0,
  checksFailed: [],
  checksPassed: [],
  conflict: false,
  lastActivityAt: 0,
});

export function emptyTracking(): Tracking {
  const list = { etags: [], seen: [] };
  return {
    v: 1,
    pr: { etag: null, open: true, merged: false, mergeable: null, headSha: null },
    reviews: list,
    issueComments: list,
    reviewComments: list,
    checkRuns: { sha: null, etags: [], reported: {} },
    status: { sha: null, etag: null, reported: {} },
  };
}

export const emptyCursor = (): Cursor => ({
  ...emptyTracking(),
  written: emptyTally(),
  fresh: emptyTally(),
});

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');
const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'number');
const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((v) => typeof v === 'string');
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isListCursor = (value: unknown): value is ListCursor =>
  isRecord(value) && isStringArray(value['etags']) && isNumberArray(value['seen']);

const isTally = (value: unknown): value is Tally =>
  isRecord(value) &&
  typeof value['reviews'] === 'number' &&
  isStringArray(value['reviewAuthors']) &&
  typeof value['comments'] === 'number' &&
  isStringArray(value['checksFailed']) &&
  isStringArray(value['checksPassed']) &&
  typeof value['conflict'] === 'boolean' &&
  typeof value['lastActivityAt'] === 'number';

/** The cursor a watch persisted, or null when there is none or it is not a cursor this code
 *  wrote. The caller treats null as a first poll. */
export function readCursor(value: unknown): Cursor | null {
  if (!isRecord(value) || value['v'] !== 1) return null;
  const { pr, checkRuns, status } = value;
  if (
    !isRecord(pr) ||
    !isNullableString(pr['etag']) ||
    typeof pr['open'] !== 'boolean' ||
    typeof pr['merged'] !== 'boolean' ||
    (pr['mergeable'] !== null && typeof pr['mergeable'] !== 'boolean') ||
    !isNullableString(pr['headSha']) ||
    !isListCursor(value['reviews']) ||
    !isListCursor(value['issueComments']) ||
    !isListCursor(value['reviewComments']) ||
    !isRecord(checkRuns) ||
    !isNullableString(checkRuns['sha']) ||
    !isStringArray(checkRuns['etags']) ||
    !isStringRecord(checkRuns['reported']) ||
    !isRecord(status) ||
    !isNullableString(status['sha']) ||
    !isNullableString(status['etag']) ||
    !isStringRecord(status['reported']) ||
    !isTally(value['written']) ||
    !isTally(value['fresh'])
  )
    return null;
  return value as unknown as Cursor;
}

/** GitHub stamps whole seconds while `createdAt` has milliseconds, so activity in the creation
 *  second can't be ordered against the watch. It counts as new: a duplicate is cheaper than a
 *  missed wake. */
const sinceCreation = (at: number, createdAt: number): boolean =>
  Math.floor(at / 1000) >= Math.floor(createdAt / 1000);

/** Items not yet seen. On a first poll (no cursor), only an item whose `effectiveAt` is at or after
 *  the watch's creation second counts as new; the rest are baseline. A seen set rather than a
 *  high-water id, because GitHub mints a review's id when it is started, not when it is
 *  submitted. `seen` only grows: a page that came back 304 contributes nothing. */
export function newListItems<T extends { readonly id: number }>(
  items: readonly T[],
  seen: readonly number[],
  firstPoll: boolean,
  createdAt: number,
  effectiveAt: (item: T) => number,
): { fresh: T[]; seen: number[] } {
  const known = new Set(seen);
  const fresh: T[] = [];
  for (const item of items) {
    if (known.has(item.id)) continue;
    known.add(item.id);
    if (!firstPoll || sinceCreation(effectiveAt(item), createdAt)) fresh.push(item);
  }
  return { fresh, seen: [...known] };
}

/** A check run or commit status that reached a reportable state, with the sha it was read on. */
export type CheckTransition = {
  readonly name: string;
  readonly outcome: 'failed' | 'passed';
  readonly at: number;
} & (
  | {
      readonly kind: 'check-run';
      readonly id: number;
      readonly conclusion: string;
      readonly headSha: string | null;
    }
  | { readonly kind: 'status'; readonly state: string; readonly headSha: string | null }
);

const CHECK_FAILURES = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

/** Completed runs that finished in or after the watch's creation second and are not already reported in
 *  that state. A run re-run in place gets a new `completed_at`, so it fires again. A run that
 *  finishes with another conclusion (skipped, cancelled, neutral) is recorded but not reported.
 *  `headSha` is the commit the runs were fetched for. */
export function checkTransitions(
  runs: readonly CheckRunFact[],
  reported: Readonly<Record<string, string>>,
  createdAt: number,
  headSha: string | null,
): { transitions: CheckTransition[]; reported: Record<string, string> } {
  const next = { ...reported };
  const transitions: CheckTransition[] = [];
  for (const run of runs) {
    if (run.completedAt === null || run.conclusion === null) continue;
    const key = `${run.conclusion}@${String(run.completedAt)}`;
    if (next[String(run.id)] === key) continue;
    next[String(run.id)] = key;
    if (!sinceCreation(run.completedAt, createdAt)) continue;
    const outcome = CHECK_FAILURES.has(run.conclusion)
      ? 'failed'
      : run.conclusion === 'success'
        ? 'passed'
        : null;
    if (outcome !== null)
      transitions.push({
        kind: 'check-run',
        id: run.id,
        name: run.name,
        conclusion: run.conclusion,
        outcome,
        at: run.completedAt,
        headSha,
      });
  }
  return { transitions, reported: next };
}

/** The same for commit statuses, by context. `pending` is not recorded, so the state it moves to
 *  is still news. */
export function statusTransitions(
  statuses: readonly StatusFact[],
  reported: Readonly<Record<string, string>>,
  createdAt: number,
  headSha: string | null,
): { transitions: CheckTransition[]; reported: Record<string, string> } {
  const next = { ...reported };
  const transitions: CheckTransition[] = [];
  for (const status of statuses) {
    const failed = status.state === 'failure' || status.state === 'error';
    if (!failed && status.state !== 'success') continue;
    const key = `${status.state}@${String(status.updatedAt)}`;
    if (next[status.context] === key) continue;
    next[status.context] = key;
    if (!sinceCreation(status.updatedAt, createdAt)) continue;
    transitions.push({
      kind: 'status',
      name: status.context,
      state: status.state,
      outcome: failed ? 'failed' : 'passed',
      at: status.updatedAt,
      headSha,
    });
  }
  return { transitions, reported: next };
}

/** `mergeable: null` means GitHub is still computing, so the previous reading stands. The
 *  first known reading is a baseline; a conflict is a known `true` turning into `false`. */
export function conflictTransition(
  previous: boolean | null,
  mergeable: boolean | null,
): { fires: boolean; next: boolean | null } {
  if (mergeable === null) return { fires: false, next: previous };
  return { fires: previous === true && mergeable === false, next: mergeable };
}

/** New activity as the digest sees it: no content, only who and when. */
export interface Activity {
  readonly reviews: readonly {
    readonly id: number;
    readonly login: string;
    readonly state: string;
    readonly at: number;
  }[];
  readonly issueComments: readonly {
    readonly id: number;
    readonly login: string;
    readonly at: number;
  }[];
  readonly reviewComments: readonly {
    readonly id: number;
    readonly login: string;
    readonly reviewId: number | null;
    readonly at: number;
  }[];
  readonly checks: readonly CheckTransition[];
  /** Set when the PR turned conflicting, with the head sha it was seen on. */
  readonly conflict: { readonly headSha: string | null } | null;
  /** Set when the PR is no longer open. */
  readonly closed: { readonly merged: boolean } | null;
}

/** One fetch of a watch: what is new, and the cursor tracking to adopt if it is merged. */
export interface Observation {
  readonly activity: Activity;
  readonly tracking: Tracking;
}
