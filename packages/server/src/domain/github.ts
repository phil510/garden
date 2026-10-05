/** What `gh api --include` printed: the status line, the headers (names lower-cased) and the body. */
export interface GhResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const STATUS_LINE = /^HTTP\/\S+\s+(\d{3})/;

/** Splits `gh api --include` output; null when it does not start with an HTTP status line. A
 *  304 has no body, so a missing blank line is not an error. */
export function parseGhInclude(stdout: string): GhResponse | null {
  const separator = /\r?\n\r?\n/.exec(stdout);
  const head = separator === null ? stdout : stdout.slice(0, separator.index);
  const body = separator === null ? '' : stdout.slice(separator.index + separator[0].length);
  const [statusLine = '', ...headerLines] = head.split(/\r?\n/);
  const match = STATUS_LINE.exec(statusLine);
  if (match === null) return null;
  const headers: Record<string, string> = {};
  for (const headerLine of headerLines) {
    const colon = headerLine.indexOf(':');
    if (colon > 0)
      headers[headerLine.slice(0, colon).trim().toLowerCase()] = headerLine.slice(colon + 1).trim();
  }
  return { status: Number(match[1]), headers, body };
}

const SECONDARY_LIMIT_FALLBACK_MS = 60_000;

/** Epoch ms to resume at when the response is a rate limit, else null. A primary limit is a
 *  403/429 with no calls remaining and waits for the reset time; a secondary limit waits for
 *  `Retry-After`, or a minute when GitHub names the limit in the body without saying how long. */
export function rateLimitResumeAt(response: GhResponse, now: number): number | null {
  if (response.status !== 403 && response.status !== 429) return null;
  const { headers } = response;
  const retryAfter = Number(headers['retry-after']);
  if (headers['retry-after'] !== undefined && Number.isFinite(retryAfter))
    return now + retryAfter * 1000;
  if (headers['x-ratelimit-remaining'] === '0') {
    const reset = Number(headers['x-ratelimit-reset']);
    if (Number.isFinite(reset)) return reset * 1000;
  }
  if (/secondary rate limit/i.test(response.body)) return now + SECONDARY_LIMIT_FALLBACK_MS;
  return null;
}

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
