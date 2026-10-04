import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GitError,
  branch,
  remoteUrl,
  repoRoot,
  status,
  workTreePrefix,
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

  it('reads the origin remote URL and reports none for a repository without one', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);

    expect(await remoteUrl(dir)).toBeNull();

    git(dir, ['remote', 'add', 'origin', 'git@github.com:acme/widgets.git']);
    expect(await remoteUrl(dir)).toBe('git@github.com:acme/widgets.git');
  });

  it('fails with a GitError when asked for the remote of a directory that is not a repository', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));

    await expect(remoteUrl(dir)).rejects.toBeInstanceOf(GitError);
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

  it('kills a git call that never exits instead of hanging forever', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    // A `git` on PATH that never returns, standing in for a stalled network mount or an
    // ejected volume: the real binary would otherwise be indistinguishable from one that is
    // just slow, so this has to hang for real rather than mock the timeout away.
    const fakeBinDir = join(dir, 'fake-bin');
    mkdirSync(fakeBinDir);
    const fakeGit = join(fakeBinDir, 'git');
    writeFileSync(fakeGit, '#!/bin/sh\nsleep 30\n');
    chmodSync(fakeGit, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}:${originalPath ?? ''}`;
    try {
      await expect(branch(dir)).rejects.toBeInstanceOf(GitError);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
