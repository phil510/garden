import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { RepoEntry } from '@garden/shared';
import type { GitPort } from './ports.js';

export interface ReposDeps {
  readonly git: GitPort;
  readonly roots: readonly string[];
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
async function repoEntry(git: GitPort, dir: string, isWorktree: boolean): Promise<RepoEntry> {
  const branch = await git.branch(dir).catch(() => null);
  return { path: dir, name: basename(dir), branch, isWorktree };
}

/**
 * `.worktrees/` nests one directory per branch-name path segment (`.worktrees/feat/x` for
 * branch `feat/x`), so a worktree can sit several levels deep. Recurse until a directory is a
 * git working tree in its own right, then stop — nothing inside a worktree is another one.
 */
async function findWorktrees(git: GitPort, dir: string): Promise<RepoEntry[]> {
  const entries: RepoEntry[] = [];
  for (const child of await subdirectories(dir)) {
    if (await isGitWorkingTree(child)) {
      entries.push(await repoEntry(git, child, true));
    } else {
      entries.push(...(await findWorktrees(git, child)));
    }
  }
  return entries;
}

/**
 * A repo's own toplevel and a worktree's toplevel are both the directory itself, so that
 * alone can't tell them apart. `repoRoot` resolves through `--git-common-dir` instead, which a
 * repo shares with every one of its worktrees: equal to `dir` only for the checkout that owns
 * the `.git` directory, and pointing elsewhere for a worktree checked out beside it. git always
 * resolves symlinks in the path it hands back (macOS's `/var` is a symlink to `/private/var`),
 * so `dir` is resolved the same way before the comparison.
 */
async function isRepo(git: GitPort, dir: string): Promise<boolean> {
  const root = await git.repoRoot(dir).catch(() => undefined);
  if (root === undefined) return false;
  const resolvedDir = await realpath(dir).catch(() => dir);
  return root === resolvedDir;
}

/** Repos and their worktrees under the configured roots, for the new-session picker. */
export async function listRepos(deps: ReposDeps): Promise<RepoEntry[]> {
  const repos: RepoEntry[] = [];
  for (const root of deps.roots) {
    for (const candidate of await subdirectories(root)) {
      if (!(await isGitWorkingTree(candidate))) continue;
      if (!(await isRepo(deps.git, candidate))) continue; // a worktree stray under a root, not a repo
      repos.push(await repoEntry(deps.git, candidate, false));
      repos.push(...(await findWorktrees(deps.git, join(candidate, '.worktrees'))));
    }
  }
  return repos;
}
