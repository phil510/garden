import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { RepoEntry } from '@garden/shared';
import type { GitPort } from './ports.js';

type ReposGit = Pick<GitPort, 'repoRoot' | 'branch'>;

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
 *  through every recursive `findWorktrees` call as a parameter — a fresh limiter per recursion
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
 * Whether `dir` is itself a git working tree root (a repo or a linked worktree), rather than
 * an ordinary directory that merely sits inside one. A repo has `.git` as a directory; a
 * linked worktree has it as a file (a gitlink to the repo's `.git/worktrees/<name>`) — either
 * shape means `dir` carries its own git identity. This can't be answered by running a git
 * command in `dir` instead: git searches upward through ancestor directories for `.git`, so a
 * plain subdirectory nested inside a repo's working tree (`.worktrees/feat` before its leaf
 * worktree exists) resolves successfully against that ancestor and looks like a hit.
 */
async function isGitWorkingTree(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

/** A repo with no commits yet has no branch to resolve; that failure is reported as
 *  `branch: null` rather than dropping the repo. */
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
 * `.worktrees/` nests one directory per branch-name path segment (`.worktrees/feat/x` for
 * branch `feat/x`), so a worktree can sit several levels deep. Recurse until a directory is a
 * git working tree in its own right, then stop — nothing inside a worktree is another one.
 *
 * Each directory's children are explored concurrently (`Promise.all`, which preserves input
 * order regardless of settle order), but the recursive call itself never goes through
 * `limiter` — only the leaf `repoEntry` git call does. A parent holding a slot while it awaits
 * children that need slots from the same pool would deadlock once the tree is deeper than the
 * limiter's bound.
 */
async function findWorktrees(git: ReposGit, limiter: Limiter, dir: string): Promise<RepoEntry[]> {
  const results = await Promise.all(
    (await subdirectories(dir)).map(async (child): Promise<RepoEntry[]> => {
      if (await isGitWorkingTree(child)) {
        return [await repoEntry(git, limiter, child, true)];
      }
      return findWorktrees(git, limiter, child);
    }),
  );
  return results.flat();
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

/** Repos and their worktrees under the configured roots, for the new-session picker. One
 *  limiter is created here and threaded through every call for the whole `listRepos` invocation,
 *  so `MAX_CONCURRENT_GIT_SPAWNS` bounds the total number of concurrent git subprocesses across
 *  every root and every recursion level, not per level. Candidates (and roots) are explored
 *  concurrently via `Promise.all`, which preserves input order in its result regardless of which
 *  one settles first — so this keeps the same repo-then-its-worktrees, in-input-order shape the
 *  sequential version produced. */
export async function listRepos(deps: ReposDeps): Promise<RepoEntry[]> {
  const limiter = createLimiter(MAX_CONCURRENT_GIT_SPAWNS);
  const perRoot = await Promise.all(
    deps.roots.map(async (root): Promise<RepoEntry[]> => {
      const candidates = await Promise.all(
        (await subdirectories(root)).map(async (candidate): Promise<RepoEntry[]> => {
          if (!(await isGitWorkingTree(candidate))) return [];
          if (!(await isRepo(deps.git, limiter, candidate))) return []; // a worktree stray under a root, not a repo
          const entry = await repoEntry(deps.git, limiter, candidate, false);
          const worktrees = await findWorktrees(deps.git, limiter, join(candidate, '.worktrees'));
          return [entry, ...worktrees];
        }),
      );
      return candidates.flat();
    }),
  );
  return perRoot.flat();
}
