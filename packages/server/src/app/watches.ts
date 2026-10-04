import { randomUUID } from 'node:crypto';
import type { AddWatchRequest, WatchSummary } from '@garden/shared';
import {
  isRepoName,
  parseGitHubRepo,
  pruneWatches,
  removeWatch as removeWatchRule,
  summarizeWatches,
  upsertWatch,
} from '../domain/watches.js';
import type { Watch } from '../domain/watches.js';
import { AmbiguousWatchError, RepoUnresolvedError, WatchNotFoundError } from './errors.js';
import type { GitPort } from './ports.js';
import type { Projection } from './projection.js';
import { findSession } from './sessions.js';

export { AmbiguousWatchError, RepoUnresolvedError, WatchNotFoundError } from './errors.js';

export interface WatchesDeps {
  readonly projection: Projection;
  readonly git: Pick<GitPort, 'remoteUrl'>;
}

const sameSummaries = (
  a: readonly WatchSummary[] | undefined,
  b: readonly WatchSummary[] | undefined,
) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/**
 * The one writer of `watches`: applies `mutate` and the pruning rule inside a single overlay
 * update, then tells the projection about every session whose summaries changed. Everything
 * that changes a watch goes through here, so pruning and the `SessionState` projection cannot
 * be bypassed. A write that changes nothing returns the overlay as it was, which skips the
 * store write. Returns the watches as they stand afterwards.
 */
export function updateWatches(
  deps: WatchesDeps,
  mutate: (watches: readonly Watch[]) => readonly Watch[],
  now: number,
): readonly Watch[] {
  let changed: [string, WatchSummary[]][] = [];
  const next = deps.projection.updateOverlay((base) => {
    const watches = pruneWatches(mutate(base.watches), now);
    if (watches === base.watches) return base;
    const before = summarizeWatches(base.watches);
    const after = summarizeWatches(watches);
    changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((sessionId) => !sameSummaries(before[sessionId], after[sessionId]))
      .map((sessionId) => [sessionId, after[sessionId] ?? []]);
    return { ...base, watches };
  });
  for (const [sessionId, watches] of changed)
    deps.projection.dispatch({ type: 'watches-changed', sessionId, watches });
  return next.watches;
}

async function resolveRepo(
  deps: WatchesDeps,
  cwd: string,
  explicit: string | undefined,
): Promise<string> {
  if (explicit !== undefined) {
    if (!isRepoName(explicit)) throw new RepoUnresolvedError(`not an owner/name repo: ${explicit}`);
    return explicit;
  }
  let url: string | null;
  try {
    url = await deps.git.remoteUrl(cwd);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RepoUnresolvedError(`could not read the git remote in ${cwd}: ${reason}`);
  }
  const repo = url === null ? null : parseGitHubRepo(url);
  if (repo === null)
    throw new RepoUnresolvedError(`no GitHub origin remote in ${cwd}; pass repo as owner/name`);
  return repo;
}

/** Adds a watch on `request.pr`, or replaces the kinds of the session's existing watch on the
 *  same repo and PR. The repo defaults to the session cwd's `origin`. */
export async function addWatch(
  deps: WatchesDeps,
  request: AddWatchRequest & { sessionId: string },
): Promise<WatchSummary> {
  const session = findSession(deps.projection, request.sessionId);
  const repo = await resolveRepo(deps, session.cwd, request.repo);
  let added: Watch | undefined;
  updateWatches(
    deps,
    (watches) => {
      const result = upsertWatch(
        watches,
        { sessionId: request.sessionId, repo, pr: request.pr, kinds: request.kinds },
        Date.now(),
        randomUUID,
      );
      added = result.watch;
      return result.watches;
    },
    Date.now(),
  );
  const [summary] = summarizeWatches(added === undefined ? [] : [added])[request.sessionId] ?? [];
  if (summary === undefined) throw new Error('watch was not recorded');
  return summary;
}

/** Without `repo` the PR is matched among the session's own watches, so removal never needs git. */
export function removeWatch(
  deps: WatchesDeps,
  request: { sessionId: string; pr: number; repo?: string },
): void {
  findSession(deps.projection, request.sessionId);
  updateWatches(
    deps,
    (watches) => {
      const result = removeWatchRule(watches, request.sessionId, request.pr, request.repo);
      if (result.outcome === 'not-found')
        throw new WatchNotFoundError(`session is not watching PR ${String(request.pr)}`);
      if (result.outcome === 'ambiguous')
        throw new AmbiguousWatchError(
          `PR ${String(request.pr)} is watched in more than one repo; pass repo`,
        );
      return result.watches;
    },
    Date.now(),
  );
}

export function listWatches(deps: WatchesDeps, sessionId: string): WatchSummary[] {
  return findSession(deps.projection, sessionId).watches;
}

/** Boot: applies the pruning rule to what the overlay persisted (and persists the result), then
 *  gives every session that holds watches its summaries. Run once the store has loaded. */
export function replayWatches(deps: WatchesDeps, now: number): void {
  const watches = updateWatches(deps, (current) => current, now);
  for (const [sessionId, summaries] of Object.entries(summarizeWatches(watches)))
    deps.projection.dispatch({ type: 'watches-changed', sessionId, watches: summaries });
}
