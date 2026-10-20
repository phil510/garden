// One-shot node:fs reads are allowed in app/; see the dependency rules in docs/architecture.md.
import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import type { RepoEntry } from '@garden/shared';
import type { GitPort } from './ports.js';

type ReposGit = Pick<GitPort, 'repoRoot' | 'isBareRepository' | 'branch'>;

export interface ReposDeps {
  readonly git: ReposGit;
  readonly roots: readonly string[];
}

/** Caps how many `git` subprocesses `listRepos` has spawned at once. A large root can have
 *  well over a hundred candidate directories; spawning a process per directory unbounded would
 *  fork-bomb the host, so every leaf git call goes through one shared limiter for the call. */
const MAX_CONCURRENT_GIT_SPAWNS = 8;

interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** A counting semaphore, not a queue of work: callers hand it a thunk to run once a slot is
 *  free rather than enqueuing the work itself, so a rejection propagates to the caller exactly
 *  as if the limiter weren't there. One instance is created per `listRepos` call and threaded
 *  through every recursive `walk` call as a parameter — a fresh limiter per recursion
 *  level would multiply the effective bound by the tree's branching factor instead of capping
 *  it globally. */
function createLimiter(maxConcurrent: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  /** Hands the freed slot straight to the next waiter rather than decrementing `active` and
   *  letting it re-acquire — that keeps a released slot from being claimed by an unrelated
   *  acquire that raced in after this one queued. */
  function release(): void {
    const next = queue.shift();
    if (next !== undefined) {
      next();
    } else {
      active -= 1;
    }
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

async function subdirectories(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name));
}

/**
 * What `dir`'s own `.git` is, if it has one — whether `dir` carries its own git identity rather
 * than merely sitting inside a repo. A repo has `.git` as a directory; a linked worktree has it
 * as a file (a gitlink to the repo's `.git/worktrees/<name>`), and so does the directory holding
 * a bare clone (`gitdir: ./.bare`). This can't be answered by running a git command in `dir`
 * instead: git searches upward through ancestor directories for `.git`, so a plain subdirectory
 * nested inside a repo's working tree (`.worktrees/feat` before its leaf worktree exists)
 * resolves successfully against that ancestor and looks like a hit.
 */
async function gitEntry(dir: string): Promise<'directory' | 'file' | null> {
  try {
    return (await stat(join(dir, '.git'))).isDirectory() ? 'directory' : 'file';
  } catch {
    return null;
  }
}

/** A branch that can't be resolved is reported as `branch: null` rather than dropping the
 *  repo. */
async function repoEntry(
  git: ReposGit,
  limiter: Limiter,
  dir: string,
  isWorktree: boolean,
): Promise<RepoEntry> {
  const branch = await limiter.run(() => git.branch(dir)).catch(() => null);
  return { path: dir, name: basename(dir), branch, isWorktree };
}

/**
 * A repo's own toplevel and a worktree's toplevel are both the directory itself, so that
 * alone can't tell them apart. `repoRoot` resolves through `--git-common-dir` instead, which a
 * repo shares with every one of its worktrees: equal to `dir` only for the checkout that owns
 * the `.git` directory, and pointing elsewhere for a worktree checked out beside it. git always
 * resolves symlinks in the path it hands back (macOS's `/var` is a symlink to `/private/var`),
 * so `dir` is resolved the same way before the comparison.
 */
async function isRepo(git: ReposGit, limiter: Limiter, dir: string): Promise<boolean> {
  const root = await limiter.run(() => git.repoRoot(dir)).catch(() => undefined);
  if (root === undefined) return false;
  const resolvedDir = await realpath(dir).catch(() => dir);
  return root === resolvedDir;
}

const WORKTREES = '.worktrees';

/** Where a directory sits relative to a configured root: a child of the root, a child of a repo,
 *  a child of a bare clone's directory, or a descendant of a repo's `.worktrees/`. */
type Position = 'root' | 'repo' | 'bare-repo' | 'worktrees';

interface Step {
  /** Set when the directory is itself a listed entry. */
  readonly listed?: 'repo' | 'worktree';
  /** Set when listed entries may sit below the directory, and at which position its children are. */
  readonly next?: Position;
}

/**
 * The one rule for what `listRepos` lists, applied to a single directory at `pos`. A root's
 * child qualifies as a repo, a repo's only interesting child is `.worktrees`, and below that
 * the first directory with its own `.git` is a worktree (nothing inside one is another).
 * A bare clone's directory (`.bare/` beside a `.git` gitlink to it) has no working tree of its
 * own; its worktrees are checked out directly beside the clone, so every visible child is
 * searched the way `.worktrees` is.
 * `listRepos` walks this step over directory listings; `isListedPath` folds it over one path.
 */
async function step(git: ReposGit, limiter: Limiter, pos: Position, dir: string): Promise<Step> {
  switch (pos) {
    case 'root': {
      const entry = await gitEntry(dir);
      // a worktree stray under a root has a `.git` too, but is not a repo
      if (entry === null || !(await isRepo(git, limiter, dir))) return {};
      // Asked of git rather than inferred from the gitlink: `--separate-git-dir` also leaves a
      // `.git` file in a repo's own directory, and that directory is a working tree to stay out of.
      const bare =
        entry === 'file' && (await limiter.run(() => git.isBareRepository(dir)).catch(() => false));
      return { listed: 'repo', next: bare ? 'bare-repo' : 'repo' };
    }
    case 'repo':
      return basename(dir) === WORKTREES ? { next: 'worktrees' } : {};
    case 'bare-repo':
      // `.bare/` itself, and anything else hidden, is not where worktrees are checked out
      return basename(dir).startsWith('.') ? {} : worktreesStep(dir);
    case 'worktrees':
      return worktreesStep(dir);
  }
}

async function worktreesStep(dir: string): Promise<Step> {
  return (await gitEntry(dir)) !== null ? { listed: 'worktree' } : { next: 'worktrees' };
}

/**
 * `.worktrees/` nests one directory per branch-name path segment (`.worktrees/feat/x` for
 * branch `feat/x`), so a worktree can sit several levels deep. Each directory's children are
 * explored concurrently (`Promise.all`, which preserves input order regardless of settle
 * order), but the recursive call itself never goes through `limiter` — only the leaf git calls
 * do. A parent holding a slot while it awaits children that need slots from the same pool would
 * deadlock once the tree is deeper than the limiter's bound.
 */
async function walk(
  git: ReposGit,
  limiter: Limiter,
  pos: Position,
  dir: string,
): Promise<RepoEntry[]> {
  const children = pos === 'repo' ? [join(dir, WORKTREES)] : await subdirectories(dir);
  const results = await Promise.all(
    children.map(async (child): Promise<RepoEntry[]> => {
      const { listed, next } = await step(git, limiter, pos, child);
      const own =
        listed === undefined ? [] : [await repoEntry(git, limiter, child, listed === 'worktree')];
      const below = next === undefined ? [] : await walk(git, limiter, next, child);
      return [...own, ...below];
    }),
  );
  return results.flat();
}

/** Repos and their worktrees under the configured roots, for the new-session picker. One
 *  limiter is created here and threaded through every call for the whole `listRepos` invocation,
 *  so `MAX_CONCURRENT_GIT_SPAWNS` bounds the total number of concurrent git subprocesses across
 *  every root and every recursion level, not per level. Candidates (and roots) are explored
 *  concurrently via `Promise.all`, which preserves input order in its result regardless of which
 *  one settles first — so this keeps the repo-then-its-worktrees, in-input-order shape. */
export async function listRepos(deps: ReposDeps): Promise<RepoEntry[]> {
  const limiter = createLimiter(MAX_CONCURRENT_GIT_SPAWNS);
  const perRoot = await Promise.all(
    deps.roots.map((root) => walk(deps.git, limiter, 'root', root)),
  );
  return perRoot.flat();
}

/** Whether `real` (an absolute realpath) is an entry `listRepos` would list, checked by running
 *  `step` down the path from each configured root rather than scanning the roots. */
export async function isListedPath(deps: ReposDeps, real: string): Promise<boolean> {
  // One git spawn per root at most, so there is nothing for a limiter to bound.
  const limiter: Limiter = { run: (fn) => fn() };
  for (const root of deps.roots) {
    const rootReal = await realpath(root).catch(() => undefined);
    if (rootReal === undefined) continue;
    const rel = relative(rootReal, real);
    if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) continue;
    const segments = rel.split(sep);
    let pos: Position = 'root';
    let dir = rootReal;
    for (const [i, segment] of segments.entries()) {
      dir = join(dir, segment);
      const { listed, next } = await step(deps.git, limiter, pos, dir);
      if (i === segments.length - 1) {
        if (listed !== undefined) return true;
        break;
      }
      if (next === undefined) break;
      pos = next;
    }
  }
  return false;
}
