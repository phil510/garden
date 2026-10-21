import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GitError,
  createBranchReader,
  remoteUrl,
  repoRoot,
  status,
  workTreePrefix,
} from '../../packages/server/src/adapters/git.js';
import { initRepo, runGit } from './support/git.js';

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
    runGit(repoDir, ['worktree', 'add', worktreeDir, '-b', 'feat/x']);

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

    runGit(dir, ['remote', 'add', 'origin', 'git@github.com:acme/widgets.git']);
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
    runGit(repoDir, ['worktree', 'add', worktreeDir, '-b', 'feat/x']);
    const nested = join(worktreeDir, 'src', 'lib');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'tracked.txt'), 'one\n');
    runGit(worktreeDir, ['add', 'src/lib/tracked.txt']);
    runGit(worktreeDir, ['commit', '-m', 'add a nested file']);
    writeFileSync(join(nested, 'tracked.txt'), 'two\n');

    expect(await workTreePrefix(worktreeDir)).toBe('');
    expect(await workTreePrefix(nested)).toBe('src/lib/');
    // The prefix and the status paths share a basis: the worktree, not the repo it came from.
    expect(await status(nested)).toContainEqual({ path: 'src/lib/tracked.txt', status: ' M' });
  });

  describe('branch', () => {
    it('reports the checked-out branch of a repository, from a subdirectory too', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
      initRepo(dir);
      runGit(dir, ['checkout', '-b', 'feat/y']);
      const nested = join(dir, 'src', 'lib');
      mkdirSync(nested, { recursive: true });

      const branch = createBranchReader();
      expect(await branch(dir)).toBe('feat/y');
      expect(await branch(nested)).toBe('feat/y');
    });

    it('gives a linked worktree its own HEAD and follows a checkout in either place', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
      const repoDir = join(dir, 'repo');
      mkdirSync(repoDir);
      initRepo(repoDir);
      const worktreeDir = join(dir, 'worktree');
      runGit(repoDir, ['worktree', 'add', worktreeDir, '-b', 'feat/x']);

      const branch = createBranchReader();
      expect(await branch(repoDir)).toBe('main');
      expect(await branch(worktreeDir)).toBe('feat/x');

      runGit(worktreeDir, ['checkout', '-b', 'feat/z']);
      expect(await branch(worktreeDir)).toBe('feat/z');
      expect(await branch(repoDir)).toBe('main');
    });

    it('reports HEAD for a detached checkout', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
      initRepo(dir);
      runGit(dir, ['checkout', '--detach']);

      expect(await createBranchReader()(dir)).toBe('HEAD');
    });

    it('rejects when the cwd is gone even though the worktree gitdir HEAD survives', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
      const repoDir = join(dir, 'repo');
      mkdirSync(repoDir);
      initRepo(repoDir);
      const worktreeDir = join(dir, 'worktree');
      runGit(repoDir, ['worktree', 'add', worktreeDir, '-b', 'feat/x']);

      const branch = createBranchReader();
      expect(await branch(worktreeDir)).toBe('feat/x');
      rmSync(worktreeDir, { recursive: true });
      // The worktree's metadata under the main repo's .git is what a stale read would hit.
      expect(
        readFileSync(join(repoDir, '.git', 'worktrees', 'worktree', 'HEAD'), 'utf8'),
      ).toContain('feat/x');

      await expect(branch(worktreeDir)).rejects.toBeInstanceOf(GitError);
    });

    it('remembers a directory is not a repository for a while, then notices it became one', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
      let clock = 0;
      const branch = createBranchReader(() => clock);
      await expect(branch(dir)).rejects.toBeInstanceOf(GitError);

      initRepo(dir);
      await expect(branch(dir)).rejects.toBeInstanceOf(GitError);

      clock += 30_000;
      expect(await branch(dir)).toBe('main');
    });

    it('spawns git to discover a cwd once and never again while HEAD stays readable', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
      initRepo(dir);
      // A `git` on PATH that logs each launch and then runs the real one, so the count is of
      // real process launches rather than of calls into a seam.
      const fakeBinDir = join(dir, 'fake-bin');
      mkdirSync(fakeBinDir);
      const log = join(dir, 'git-calls.log');
      const realGit = execFileSync('which', ['git']).toString().trim();
      const fakeGit = join(fakeBinDir, 'git');
      writeFileSync(fakeGit, `#!/bin/sh\necho "$@" >> '${log}'\nexec '${realGit}' "$@"\n`);
      chmodSync(fakeGit, 0o755);
      const launches = () => readFileSync(log, 'utf8').trim().split('\n').length;

      const originalPath = process.env.PATH;
      process.env.PATH = `${fakeBinDir}:${originalPath ?? ''}`;
      try {
        const branch = createBranchReader();
        expect(await branch(dir)).toBe('main');
        expect(launches()).toBe(1);

        runGit(dir, ['checkout', '-b', 'feat/y']);
        const afterCheckout = launches();
        expect(await branch(dir)).toBe('feat/y');
        expect(await branch(dir)).toBe('feat/y');
        expect(launches()).toBe(afterCheckout);
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('asks git when HEAD is a symbolic ref outside refs/heads', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
      initRepo(dir);
      runGit(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
      runGit(dir, ['symbolic-ref', 'HEAD', 'refs/remotes/origin/main']);

      expect(await createBranchReader()(dir)).toBe('origin/main');
    });
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
    runGit(dir, ['mv', 'README.md', 'RENAMED.md']);

    const entries = await status(dir);
    expect(entries).toContainEqual({ path: 'RENAMED.md', status: 'R ' });
  });

  it('reports a gitignored path with the ignored code', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-git-'));
    initRepo(dir);
    writeFileSync(join(dir, '.gitignore'), 'ignored.log\n');
    runGit(dir, ['add', '.gitignore']);
    runGit(dir, ['commit', '-m', 'add gitignore']);
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
      await expect(createBranchReader()(dir)).rejects.toBeInstanceOf(GitError);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
