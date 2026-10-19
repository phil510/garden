/** The outcome of one conditional GET, as the poller needs it. Other failures (a timeout, output
 *  that is not a response) are thrown. */
export type GhResult =
  | { readonly kind: 'ok'; readonly etag: string | null; readonly body: unknown }
  | { readonly kind: 'not-modified' }
  | { readonly kind: 'inaccessible'; readonly status: 403 | 404 }
  | { readonly kind: 'rate-limited'; readonly resumeAt: number }
  | { readonly kind: 'unavailable'; readonly reason: 'missing' | 'logged-out' };

export interface PrFact {
  readonly open: boolean;
  readonly merged: boolean;
  /** null while GitHub is still computing it. */
  readonly mergeable: boolean | null;
  readonly headSha: string;
}

export interface ReviewFact {
  readonly id: number;
  readonly login: string;
  readonly submittedAt: number;
  /** GitHub's review state, such as `APPROVED` or `CHANGES_REQUESTED`. */
  readonly state: string;
  /** An empty-body COMMENTED review: the shell GitHub makes around a standalone inline comment
   *  or a thread reply. Only the comment counts, never the shell. */
  readonly wrapper: boolean;
}

export interface CommentFact {
  readonly id: number;
  readonly login: string;
  readonly createdAt: number;
  /** The review an inline comment belongs to; null for a plain issue comment. */
  readonly reviewId: number | null;
}

export interface CheckRunFact {
  readonly id: number;
  readonly name: string;
  readonly conclusion: string | null;
  readonly completedAt: number | null;
}

export interface StatusFact {
  readonly context: string;
  readonly state: string;
  readonly updatedAt: number;
}

/** One page of parsed items. `count` is the page's raw length, so a page of skipped items
 *  still reads as full. */
export interface ParsedPage<T> {
  readonly count: number;
  readonly items: readonly T[];
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const time = (value: unknown): number | null => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? null : ms;
};
const login = (user: unknown): string => (isRecord(user) ? (str(user['login']) ?? '') : '');

export function parsePr(body: unknown): PrFact | null {
  if (!isRecord(body) || !isRecord(body['head'])) return null;
  const state = str(body['state']);
  const headSha = str(body['head']['sha']);
  if (state === null || headSha === null) return null;
  const mergeable = body['mergeable'];
  return {
    open: state === 'open',
    merged: body['merged'] === true || time(body['merged_at']) !== null,
    mergeable: typeof mergeable === 'boolean' ? mergeable : null,
    headSha,
  };
}

function parseList<T>(body: unknown, parseItem: (item: Json) => T | null): ParsedPage<T> {
  const raw = Array.isArray(body) ? body : [];
  const items: T[] = [];
  for (const item of raw) {
    const parsed = isRecord(item) ? parseItem(item) : null;
    if (parsed !== null) items.push(parsed);
  }
  return { count: raw.length, items };
}

/** Pending reviews (not yet submitted) are skipped. */
export function parseReviews(body: unknown): ParsedPage<ReviewFact> {
  return parseList(body, (item) => {
    const id = num(item['id']);
    const submittedAt = time(item['submitted_at']);
    if (id === null || submittedAt === null || item['state'] === 'PENDING') return null;
    return {
      id,
      login: login(item['user']),
      submittedAt,
      state: str(item['state']) ?? '',
      wrapper: item['state'] === 'COMMENTED' && (str(item['body']) ?? '').trim() === '',
    };
  });
}

function parseComments(body: unknown, inline: boolean): ParsedPage<CommentFact> {
  return parseList(body, (item) => {
    const id = num(item['id']);
    const createdAt = time(item['created_at']);
    if (id === null || createdAt === null) return null;
    return {
      id,
      login: login(item['user']),
      createdAt,
      reviewId: inline ? num(item['pull_request_review_id']) : null,
    };
  });
}

export const parseIssueComments = (body: unknown) => parseComments(body, false);
export const parseReviewComments = (body: unknown) => parseComments(body, true);

export function parseCheckRuns(body: unknown): ParsedPage<CheckRunFact> {
  return parseList(isRecord(body) ? body['check_runs'] : null, (item) => {
    const id = num(item['id']);
    const name = str(item['name']);
    if (id === null || name === null) return null;
    return {
      id,
      name,
      conclusion: str(item['conclusion']),
      completedAt: item['status'] === 'completed' ? time(item['completed_at']) : null,
    };
  });
}

/** The combined status endpoint's per-context entries. */
export function parseStatuses(body: unknown): ParsedPage<StatusFact> {
  return parseList(isRecord(body) ? body['statuses'] : null, (item) => {
    const context = str(item['context']);
    const state = str(item['state']);
    const updatedAt = time(item['updated_at']);
    if (context === null || state === null || updatedAt === null) return null;
    return { context, state, updatedAt };
  });
}
