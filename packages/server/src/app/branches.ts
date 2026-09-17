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

  async function resolve(cwd: string): Promise<void> {
    const branch = await deps.git.branch(cwd).catch(() => null);
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
