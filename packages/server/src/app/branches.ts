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

/** Caps how many `git` subprocesses one sweep spawns at once. Sessions accumulate for as long
 *  as their transcript file exists on disk (`reduce` never evicts one), so the distinct-cwd
 *  count this sweeps is not bounded by what's live — the same fork-bomb concern `app/repos.ts`
 *  already caps its own leaf git calls against, here recurring every poll tick instead of once. */
const MAX_CONCURRENT_GIT_SPAWNS = 8;

/** A counting semaphore: callers hand it a thunk to run once a slot is free, so a rejection
 *  propagates to the caller exactly as if the limiter weren't there. */
function createLimiter(maxConcurrent: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  // Hands the freed slot straight to the next waiter rather than decrementing `active` and
  // letting it re-acquire — that keeps a released slot from being claimed by an unrelated
  // acquire that raced in after this one queued.
  function release(): void {
    const next = queue.shift();
    if (next !== undefined) next();
    else active -= 1;
  }

  return async (fn) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/**
 * Re-resolves every session's branch on demand, unlike `watchRepoRoots`: a repo root is
 * invariant for a cwd for the life of the process, but a branch moves under a `git checkout`
 * that never touches `cwd`, so a one-shot "asked" cache would go stale the moment a session's
 * branch actually changes — the exact bug this sweeper exists to fix. The caller (`main.ts`)
 * decides the cadence by calling `tick()`; this module owns only the sweep itself.
 *
 * A failed lookup dispatches `branch: null` rather than nothing: a cwd that stops being a
 * valid git directory (its worktree removed) must not keep showing its last-known branch
 * forever, so every tick makes `branches[cwd]` an unconditional function of live git state.
 */
export function createBranchSweeper(deps: BranchSweeperDeps): BranchSweeper {
  let inFlight = false;
  let stopped = false;
  const limit = createLimiter(MAX_CONCURRENT_GIT_SPAWNS);

  async function resolve(cwd: string): Promise<void> {
    const branch = await limit(() => deps.git.branch(cwd)).catch(() => null);
    if (stopped) return;
    deps.projection.dispatch({ type: 'branch-resolved', cwd, branch });
  }

  return {
    async tick() {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        const cwds = new Set(
          deps.projection
            .sessions()
            .map((session) => session.cwd)
            .filter((cwd) => cwd !== ''),
        );
        await Promise.allSettled([...cwds].map(resolve));
      } finally {
        inFlight = false;
      }
    },
    stop() {
      stopped = true;
    },
  };
}
