import type { GitPort } from './ports.js';
import type { Projection } from './projection.js';

export interface RepoInfoDeps {
  readonly git: Pick<GitPort, 'repoInfo'>;
  readonly projection: Projection;
}

/**
 * Supplies the session facts the fold cannot derive on its own: a cwd's repo root and its
 * worktree identity both have to be asked of git, and `reduce` runs no I/O. So this watches the
 * projection for cwds it has not asked about yet, asks once with `git.repoInfo` (one process,
 * both facts), and dispatches the answer back as a fact — the same shape as every other
 * adapter-sourced event, which is what keeps the fold pure. Resolving both facts from the same
 * call, rather than in two independent watchers, means a session can never observe one without
 * the other for a delta cycle.
 *
 * Watching state rather than hooking each way a cwd can arrive is deliberate: a cwd reaches
 * the projection from a registered session, a transcript slice and a hook payload alike, and
 * a boot replay dispatches dozens of them before any client connects. One sweep over the
 * sessions covers all of those, with no resolution site to forget.
 *
 * Each cwd is asked about once. A directory in no repo makes git fail, and that failure is
 * the answer rather than something to retry: no fact is dispatched, so the session keeps the
 * null root and null worktree it started with and works without a sidebar group or worktree
 * line.
 */
export function watchRepoInfo(deps: RepoInfoDeps): () => void {
  const asked = new Set<string>();

  function resolve(cwd: string): void {
    if (cwd === '' || asked.has(cwd)) return;
    asked.add(cwd);
    void deps.git
      .repoInfo(cwd)
      .then(({ repoRoot, worktree }) => {
        deps.projection.dispatch({ type: 'repo-info-resolved', cwd, repoRoot, worktree });
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
