import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listRepos } from '../../src/app/repos.js';
import type { GitPort } from '../../src/app/ports.js';
import { createBranchReader, repoRoot } from '../../src/adapters/git.js';

const git: Pick<GitPort, 'repoRoot' | 'branch'> = { repoRoot, branch: createBranchReader() };

function runGit(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd });
}

function initRepo(dir: string): void {
  runGit(dir, ['init', '--initial-branch=main']);
  runGit(dir, ['config', 'user.email', 'garden-test@example.com']);
  runGit(dir, ['config', 'user.name', 'garden test']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  runGit(dir, ['add', 'README.md']);
  runGit(dir, ['commit', '-m', 'initial commit']);
}

describe('listRepos against real git repos and a real worktree', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('lists a repo on the checked-out branch and its worktree on its own branch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    initRepo(repo);
    const worktree = join(repo, '.worktrees', 'feat', 'x');
    mkdirSync(join(repo, '.worktrees', 'feat'), { recursive: true });
    runGit(repo, ['worktree', 'add', worktree, '-b', 'feat/x']);

    const repos = await listRepos({ git, roots: [dir] });

    // The reported path is the one the picker browsed, not git's resolved one — those can
    // differ under a symlinked root (macOS's /var -> /private/var), and only the internal
    // repo/worktree comparison needs the resolved form.
    expect(repos).toEqual([
      { path: repo, name: 'repo', branch: 'main', isWorktree: false },
      { path: worktree, name: 'x', branch: 'feat/x', isWorktree: true },
    ]);
  });

  it('does not list a bare non-repo directory under a root', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    mkdirSync(join(dir, 'not-a-repo'));

    expect(await listRepos({ git, roots: [dir] })).toEqual([]);
  });
});
