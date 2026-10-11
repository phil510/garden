import { createLimiter } from './limiter.js';
import type { GitPort } from './ports.js';
import type { Projection } from './projection.js';

export interface BranchSweeperDeps {
  readonly git: Pick<GitPort, 'branch'>;
  readonly projection: Projection;
}

export interface BranchSweeper {
  tick(): Promise<void>;
  stop(): void;
}

/** Caps how many `git` subprocesses one sweep spawns at once. Steady state only re-resolves
 *  live sessions' cwds (see `tick()`), which stays single digits, but the first tick after a
 *  session ends or after boot can still fan out across every dead cwd this sweeper has not
 *  settled yet — the same fork-bomb concern `app/repos.ts` already caps its own leaf git calls
 *  against, here bounding a one-time catch-up instead of a per-root listing. */
const MAX_CONCURRENT_GIT_SPAWNS = 8;

/**
 * Re-resolves a *live* session's branch on every tick, unlike `watchRepoRoots`: a repo root is
 * invariant for a cwd for the life of the process, but a branch moves under a `git checkout`
 * that never touches `cwd`, so a one-shot "asked" cache would go stale the moment a live
 * session's branch actually changes — the exact bug this sweeper exists to fix. A dead
 * session's cwd gets exactly one resolution and is then cached (in `settled`) for the rest of
 * the process's life: nothing but a live process changes a checked-out branch, so a dead cwd's
 * answer cannot go stale the way a live one can. A cwd that returns to being live (a new
 * session starting in a directory an earlier, now-dead one used) drops out of `settled` and
 * resumes re-resolving, in case it goes dead again with a different branch than last time.
 * The caller (`main.ts`) decides the cadence by calling `tick()`; this module owns the sweep.
 *
 * A failed lookup dispatches `branch: null` rather than nothing: a cwd that stops being a
 * valid git directory (its worktree removed) must not keep showing its last-known branch
 * forever, so a cwd's first sweep — live or dead — makes `branches[cwd]` an unconditional
 * function of the git state seen at that moment.
 */
export function createBranchSweeper(deps: BranchSweeperDeps): BranchSweeper {
  let inFlight = false;
  let stopped = false;
  const limit = createLimiter(MAX_CONCURRENT_GIT_SPAWNS);
  // Dead cwds already given their one resolution. Checked before re-asking git for a cwd
  // that isn't live this tick.
  const settled = new Set<string>();

  async function resolve(cwd: string): Promise<void> {
    const branch = await limit(() => deps.git.branch(cwd)).catch(() => null);
    if (stopped) return;
    deps.projection.dispatch({ type: 'branch-resolved', cwd, branch });
  }

  return {
    async tick() {
      if (inFlight || stopped) return;
      inFlight = true;
      let results: PromiseSettledResult<void>[];
      try {
        const sessions = deps.projection.sessions();
        // `liveness` marks whether garden itself is polling a tmux pane for a session, not
        // whether the underlying process is running — a session garden didn't start is always
        // `'dead'` here. Its cwd still gets exactly one resolution below, so a branch change
        // made from such a session after that point won't be picked back up.
        const live = new Set(
          sessions.filter((s) => s.liveness === 'live' && s.cwd !== '').map((s) => s.cwd),
        );
        for (const cwd of live) settled.delete(cwd);
        const uncachedDead = new Set(
          sessions
            .filter((s) => s.cwd !== '' && !live.has(s.cwd) && !settled.has(s.cwd))
            .map((s) => s.cwd),
        );
        for (const cwd of uncachedDead) settled.add(cwd);
        const cwds = new Set([...live, ...uncachedDead]);
        results = await Promise.allSettled([...cwds].map(resolve));
      } finally {
        inFlight = false;
      }
      // resolve() only rejects if a projection listener throws synchronously during dispatch —
      // deps.git.branch()'s own failures are already caught above and turned into a `null`
      // dispatch. allSettled swallows a rejection like that by design, so it has to be
      // re-raised here or it vanishes with no log and no sign the sweep hit a problem.
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejected.length > 0) {
        throw new AggregateError(
          rejected.map((r: PromiseRejectedResult) => r.reason as unknown),
          `branch sweep: ${String(rejected.length)} dispatch(es) failed unexpectedly`,
        );
      }
    },
    stop() {
      stopped = true;
    },
  };
}
