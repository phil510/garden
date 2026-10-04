import { DEFAULT_WATCH_KINDS, WATCH_KINDS } from '@garden/shared';
import type { WatchKind, WatchStatus, WatchSummary } from '@garden/shared';

/** Activity waiting to be delivered to the session. `createdAt` is when this digest id was
 *  minted: whoever replaces the digest with a new id sets a fresh `createdAt`, so the expiry
 *  clock counts from the last replacement. */
export interface PendingDigest {
  readonly id: string;
  readonly line: string;
  readonly createdAt: number;
}

/** A session's subscription to one pull request. Garden decided it and nothing can recompute
 *  it, so it lives in the overlay. Unique on `sessionId` + `repo` + `pr`. */
export interface Watch {
  readonly id: string;
  readonly sessionId: string;
  /** `owner/name`. */
  readonly repo: string;
  readonly pr: number;
  readonly kinds: readonly WatchKind[];
  /** Epoch ms the watch was created; the baseline for new activity. Never changed by a re-add. */
  readonly createdAt: number;
  /** Poller-owned progress marker. Opaque here: persisted untouched. */
  readonly cursor: unknown;
  readonly pendingDigest: PendingDigest | null;
  readonly status: WatchStatus;
  /** Why the watch is in `error`; absent otherwise, and in files written before it existed. */
  readonly errorReason?: string;
}

const DIGEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Defaults when omitted; `closed` is always on and `checks:all` implies `checks`. The result
 *  is deduped in canonical order so equal sets compare equal. */
export function normalizeKinds(kinds: readonly WatchKind[] | undefined): WatchKind[] {
  const wanted = new Set<WatchKind>(kinds ?? DEFAULT_WATCH_KINDS);
  wanted.add('closed');
  if (wanted.has('checks:all')) wanted.add('checks');
  return WATCH_KINDS.filter((kind) => wanted.has(kind));
}

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The canonical `owner/name` for a repo spelling, or null when it isn't one. GitHub treats
 *  owner and repo case-insensitively and accepts a `.git` suffix, so both are normalised away:
 *  every path that accepts or compares a repo goes through here, and equal repos compare equal. */
export function normalizeRepo(value: string): string | null {
  if (!REPO_NAME.test(value)) return null;
  const [owner, name] = value.replace(/\.git$/i, '').split('/') as [string, string];
  if ([owner, name].some((part) => part === '' || part === '.' || part === '..')) return null;
  return `${owner}/${name}`.toLowerCase();
}

const SCP_REMOTE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/;
const URL_REMOTE =
  /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([^/]+)\/(.+?)(?:\.git)?\/?$/;

/** `owner/name` for a GitHub remote URL in scp, https or ssh form; null for any other host or shape. */
export function parseGitHubRepo(url: string): string | null {
  const match = SCP_REMOTE.exec(url.trim()) ?? URL_REMOTE.exec(url.trim());
  if (match === null) return null;
  return normalizeRepo(`${match[1]}/${match[2]}`);
}

const sameKinds = (a: readonly WatchKind[], b: readonly WatchKind[]) =>
  a.length === b.length && a.every((kind, i) => kind === b[i]);

/** Adds a watch, or replaces the kinds of the one with the same session, repo and PR. A re-add
 *  touches nothing else, and returns the input array itself when the kinds are unchanged. */
export function upsertWatch(
  watches: readonly Watch[],
  input: {
    readonly sessionId: string;
    readonly repo: string;
    readonly pr: number;
    readonly kinds?: readonly WatchKind[] | undefined;
  },
  now: number,
  mintId: () => string,
): { watches: readonly Watch[]; watch: Watch } {
  const kinds = normalizeKinds(input.kinds);
  const index = watches.findIndex(
    (w) => w.sessionId === input.sessionId && w.repo === input.repo && w.pr === input.pr,
  );
  const existing = watches[index];
  if (existing === undefined) {
    const watch: Watch = {
      id: mintId(),
      sessionId: input.sessionId,
      repo: input.repo,
      pr: input.pr,
      kinds,
      createdAt: now,
      cursor: null,
      pendingDigest: null,
      status: 'active',
    };
    return { watches: [...watches, watch], watch };
  }
  if (sameKinds(existing.kinds, kinds)) return { watches, watch: existing };
  const watch: Watch = { ...existing, kinds };
  return { watches: watches.map((w, i) => (i === index ? watch : w)), watch };
}

export type RemoveWatchResult =
  | { outcome: 'removed'; watches: readonly Watch[] }
  | { outcome: 'not-found' }
  | { outcome: 'ambiguous' };

/** Removes a session's watch by PR. Without `repo` the PR must match exactly one of the
 *  session's watches. */
export function removeWatch(
  watches: readonly Watch[],
  sessionId: string,
  pr: number,
  repo?: string,
): RemoveWatchResult {
  const matches = watches.filter(
    (w) => w.sessionId === sessionId && w.pr === pr && (repo === undefined || w.repo === repo),
  );
  if (matches.length === 0) return { outcome: 'not-found' };
  if (matches.length > 1) return { outcome: 'ambiguous' };
  return { outcome: 'removed', watches: watches.filter((w) => w !== matches[0]) };
}

/** The one lifecycle rule: drop digests older than seven days, then drop every closed watch left
 *  without a digest. Acknowledging a digest and letting it expire both end as "no digest", so
 *  this covers both removal paths. Returns the input array when nothing changes. */
export function pruneWatches(watches: readonly Watch[], now: number): readonly Watch[] {
  let changed = false;
  const kept: Watch[] = [];
  for (const watch of watches) {
    const expired =
      watch.pendingDigest !== null && now - watch.pendingDigest.createdAt > DIGEST_TTL_MS;
    const current = expired ? { ...watch, pendingDigest: null } : watch;
    if (current.status === 'closed' && current.pendingDigest === null) {
      changed = true;
      continue;
    }
    if (expired) changed = true;
    kept.push(current);
  }
  return changed ? kept : watches;
}

/** Each session's watches as clients see them, ordered by repo then PR. */
export function summarizeWatches(watches: readonly Watch[]): Record<string, WatchSummary[]> {
  const bySession: Record<string, Watch[]> = {};
  for (const watch of watches) (bySession[watch.sessionId] ??= []).push(watch);
  const summaries: Record<string, WatchSummary[]> = {};
  for (const [sessionId, group] of Object.entries(bySession)) {
    summaries[sessionId] = [...group]
      .sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.pr - b.pr))
      .map((w) => ({
        repo: w.repo,
        pr: w.pr,
        kinds: [...w.kinds],
        pendingDigest: w.pendingDigest !== null,
        status: w.status,
        ...(w.errorReason === undefined ? {} : { errorReason: w.errorReason }),
      }));
  }
  return summaries;
}
