import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GitError,
  branch,
  repoRoot,
  status,
  workTreePrefix,
  worktree,
} from '../../src/adapters/git.js';

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd });
}

function initRepo(dir: string): void {
  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'garden-test@example.com']);
  git(dir, ['config', 'user.name', 'garden test']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'initial commit']);
}

describe('the git adapter', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('resolves a worktree and its parent repo to the same root', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir);
    initRepo(repoDir);
    const worktreeDir = join(dir, 'worktree');
    git(repoDir, ['worktree', 'add', worktreeDir, '-b', 'feat/x']);

    const rootFromRepo = await repoRoot(repoDir);
    const rootFromWorktree = await repoRoot(worktreeDir);
    expect(rootFromWorktree).toBe(rootFromRepo);
    // git resolves symlinks in its output (e.g. macOS's /var -> /private/var),
    // so the comparison must resolve the same way.
    expect(rootFromRepo).toBe(realpathSync(repoDir));
  });

  it('names the linked worktree for its own root and for a subdirectory beneath it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir);
    initRepo(repoDir);
    const worktreeDir = join(dir, 'x');
    git(repoDir, ['worktree', 'add', worktreeDir, '-b', 'feat/x']);
    const nested = join(worktreeDir, 'src');
    mkdirSync(nested);

    expect(await worktree(worktreeDir)).toEqual({ path: realpathSync(worktreeDir), name: 'x' });
    expect(await worktree(nested)).toEqual({ path: realpathSync(worktreeDir), name: 'x' });
  });

  it('reports no worktree for the main checkout, root or subdirectory alike', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);
    const nested = join(dir, 'packages', 'web');
    mkdirSync(nested, { recursive: true });

    // This is the case a cwd/repoRoot string comparison gets wrong: `nested` differs from the
    // repo root as a path, but its tree is still the main checkout, not a worktree.
    expect(await worktree(dir)).toBeNull();
    expect(await worktree(nested)).toBeNull();
  });

  it('reports a subdirectory as the prefix status paths are relative to', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    const repoDir = join(dir, 'repo');
    mkdirSync(repoDir);
    initRepo(repoDir);
    const worktreeDir = join(dir, 'worktree');
    git(repoDir, ['worktree', 'add', worktreeDir, '-b', 'feat/x']);
    const nested = join(worktreeDir, 'src', 'lib');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'tracked.txt'), 'one\n');
    git(worktreeDir, ['add', 'src/lib/tracked.txt']);
    git(worktreeDir, ['commit', '-m', 'add a nested file']);
    writeFileSync(join(nested, 'tracked.txt'), 'two\n');

    expect(await workTreePrefix(worktreeDir)).toBe('');
    expect(await workTreePrefix(nested)).toBe('src/lib/');
    // The prefix and the status paths share a basis: the worktree, not the repo it came from.
    expect(await status(nested)).toContainEqual({ path: 'src/lib/tracked.txt', status: ' M' });
  });

  it('reports the checked-out branch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);
    git(dir, ['checkout', '-b', 'feat/y']);
    expect(await branch(dir)).toBe('feat/y');
  });

  it('reports untracked and modified paths from status --porcelain', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);
    writeFileSync(join(dir, 'README.md'), 'changed\n');
    writeFileSync(join(dir, 'new.txt'), 'new\n');

    const entries = await status(dir);
    expect(entries).toContainEqual({ path: 'README.md', status: ' M' });
    expect(entries).toContainEqual({ path: 'new.txt', status: '??' });
  });

  it('reports a path with non-ASCII characters unescaped', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);
    writeFileSync(join(dir, 'café.txt'), 'x\n');

    const entries = await status(dir);
    expect(entries).toContainEqual({ path: 'café.txt', status: '??' });
  });

  it('reports a path containing an arrow as itself and not as a rename', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);
    writeFileSync(join(dir, 'a -> b'), 'x\n');

    const entries = await status(dir);
    expect(entries).toContainEqual({ path: 'a -> b', status: '??' });
  });

  it('reports a rename by its new path', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);
    git(dir, ['mv', 'README.md', 'RENAMED.md']);

    const entries = await status(dir);
    expect(entries).toContainEqual({ path: 'RENAMED.md', status: 'R ' });
  });

  it('reports a gitignored path with the ignored code', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);
    writeFileSync(join(dir, '.gitignore'), 'ignored.log\n');
    git(dir, ['add', '.gitignore']);
    git(dir, ['commit', '-m', 'add gitignore']);
    writeFileSync(join(dir, 'ignored.log'), 'x\n');

    const entries = await status(dir);
    expect(entries).toContainEqual({ path: 'ignored.log', status: '!!' });
  });

  it('fails with a GitError outside a git repository', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    await expect(repoRoot(dir)).rejects.toBeInstanceOf(GitError);
    await expect(repoRoot(dir)).rejects.toThrow(/not a git repository/);
  });
});
