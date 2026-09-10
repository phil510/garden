import type { GitPort } from './ports.js';
import type { Projection } from './projection.js';

export interface WorktreesDeps {
  readonly git: Pick<GitPort, 'worktree'>;
  readonly projection: Projection;
}

/**
 * Supplies the one session fact the fold cannot derive on its own: whether a cwd's working
 * tree is a linked worktree has to be asked of git, and `reduce` runs no I/O. Mirrors
 * `watchRepoRoots`'s shape exactly — same sweep-on-every-change, ask-once approach, kept as its
 * own module because it asks its own git question and caches its own set of cwds.
 *
 * A cwd whose tree turns out to be the main checkout is never dispatched, so the session keeps
 * the null worktree it started with; only an actual linked worktree produces a fact.
 */
export function watchWorktrees(deps: WorktreesDeps): () => void {
  const asked = new Set<string>();

  function resolve(cwd: string): void {
    if (cwd === '' || asked.has(cwd)) return;
    asked.add(cwd);
    void deps.git
      .worktree(cwd)
      .then((worktree) => {
        if (worktree === null) return;
        deps.projection.dispatch({ type: 'worktree-resolved', cwd, name: worktree.name });
      })
      .catch(() => undefined);
  }

  function sweep(): void {
    for (const session of deps.projection.sessions()) resolve(session.cwd);
  }

  const unsubscribe = deps.projection.subscribe(sweep);
  sweep();
  return unsubscribe;
}
