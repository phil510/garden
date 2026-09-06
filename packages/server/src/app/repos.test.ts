import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GitPort } from './ports.js';
import { listRepos } from './repos.js';

/**
 * Fakes `GitPort` by directory: a path with no entry in `roots` fails `repoRoot` exactly as a
 * non-git directory would, and a path with no entry in `branches` fails `branch` exactly as a
 * repo with no commits yet would. `roots`' values must already be resolved (`realpathSync`),
 * the way the real adapter's `git rev-parse` output always is — the tests build them that way
 * so the fake matches real behaviour on a filesystem where the temp directory itself sits
 * behind a symlink (macOS's `/var` for one).
 */
function fakeGit(
  roots: Record<string, string>,
  branches: Record<string, string> = {},
): Pick<GitPort, 'repoRoot' | 'branch'> {
  return {
    repoRoot: (cwd) => {
      const root = roots[cwd];
      return root === undefined
        ? Promise.reject(new Error(`not a git repository: ${cwd}`))
        : Promise.resolve(root);
    },
    branch: (cwd) => {
      const branch = branches[cwd];
      return branch === undefined
        ? Promise.reject(new Error(`no branch: ${cwd}`))
        : Promise.resolve(branch);
    },
  };
}

/** `listRepos` gates on a real `.git` entry existing before it trusts a directory's git
 *  identity at all, so every fake repo and worktree needs one on disk — its contents are
 *  never read, only its presence checked. */
function markAsGitDir(dir: string): void {
  mkdirSync(join(dir, '.git'), { recursive: true });
}

describe('listRepos', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('lists a repo and a single-segment worktree beside it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoA');
    const worktree = join(repo, '.worktrees', 'feat-x');
    mkdirSync(worktree, { recursive: true });
    markAsGitDir(repo);
    markAsGitDir(worktree);
    const resolvedRepo = realpathSync(repo);
    const git = fakeGit(
      { [repo]: resolvedRepo, [worktree]: resolvedRepo },
      { [repo]: 'main', [worktree]: 'feat/x' },
    );

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos).toEqual([
      { path: repo, name: 'repoA', branch: 'main', isWorktree: false },
      { path: worktree, name: 'feat-x', branch: 'feat/x', isWorktree: true },
    ]);
  });

  it('finds a worktree nested under branch-name path segments', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoB');
    const worktree = join(repo, '.worktrees', 'feat', 'y');
    mkdirSync(worktree, { recursive: true });
    markAsGitDir(repo);
    markAsGitDir(worktree);
    const resolvedRepo = realpathSync(repo);
    const git = fakeGit(
      { [repo]: resolvedRepo, [worktree]: resolvedRepo },
      { [repo]: 'main', [worktree]: 'feat/y' },
    );

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos.map((r) => r.path)).toEqual([repo, worktree]);
    expect(repos[1]).toEqual({ path: worktree, name: 'y', branch: 'feat/y', isWorktree: true });
  });

  it('does not mistake an intermediate branch-segment directory for a worktree', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoE');
    const worktree = join(repo, '.worktrees', 'feat', 'y');
    mkdirSync(worktree, { recursive: true });
    markAsGitDir(repo);
    markAsGitDir(worktree);
    // No .git under .worktrees/feat itself — only the leaf worktree has one.
    const resolvedRepo = realpathSync(repo);
    const git = fakeGit(
      { [repo]: resolvedRepo, [worktree]: resolvedRepo },
      { [repo]: 'main', [worktree]: 'feat/y' },
    );

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos.map((r) => r.path)).toEqual([repo, worktree]);
  });

  it('reports a repo with no commits as branch null rather than dropping it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoC');
    mkdirSync(repo, { recursive: true });
    markAsGitDir(repo);
    const git = fakeGit({ [repo]: realpathSync(repo) });

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos).toEqual([{ path: repo, name: 'repoC', branch: null, isWorktree: false }]);
  });

  it('skips a directory that is not a git working tree at all', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    mkdirSync(join(dir, 'notARepo'), { recursive: true });
    const git = fakeGit({});

    expect(await listRepos({ git, roots: [dir] })).toEqual([]);
  });

  it('skips a worktree checked out directly under a root rather than listing it as its own repo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoD');
    const strayWorktree = join(dir, 'strayWorktree');
    mkdirSync(repo, { recursive: true });
    mkdirSync(strayWorktree, { recursive: true });
    markAsGitDir(repo);
    markAsGitDir(strayWorktree);
    const resolvedRepo = realpathSync(repo);
    const git = fakeGit(
      { [repo]: resolvedRepo, [strayWorktree]: resolvedRepo },
      { [repo]: 'main', [strayWorktree]: 'feat/z' },
    );

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos).toEqual([{ path: repo, name: 'repoD', branch: 'main', isWorktree: false }]);
  });
});
