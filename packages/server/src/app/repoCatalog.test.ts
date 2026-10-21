import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitPort } from './ports.js';
import { REPO_CACHE_TTL_MS, RootNotListedError, createRepoCatalog } from './repoCatalog.js';

interface FakeGit extends Pick<GitPort, 'repoRoot' | 'isBareRepository' | 'branch'> {
  readonly repoRootCalls: () => number;
  readonly branchCalls: () => number;
}

/** A directory is a repo while it has a `.git` entry on disk, and `repoRoot` reports its
 *  realpath the way `git rev-parse` does. */
function fakeGit(): FakeGit {
  let calls = 0;
  let branchCalls = 0;
  return {
    repoRootCalls: () => calls,
    branchCalls: () => branchCalls,
    repoRoot: (cwd) => {
      calls += 1;
      try {
        realpathSync(join(cwd, '.git'));
        return Promise.resolve(realpathSync(cwd));
      } catch {
        return Promise.reject(new Error(`not a git repository: ${cwd}`));
      }
    },
    isBareRepository: () => Promise.resolve(false),
    branch: () => {
      branchCalls += 1;
      return Promise.resolve('main');
    },
  };
}

describe('createRepoCatalog', () => {
  let dir: string;
  let repoA: string;
  let other: string;

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-catalog-')));
    repoA = join(dir, 'repoA');
    other = join(dir, 'other');
    mkdirSync(join(repoA, '.git'), { recursive: true });
    mkdirSync(other);
  }

  it('rejects a relative root without scanning', async () => {
    setup();
    const git = fakeGit();
    const catalog = createRepoCatalog({ git, roots: [dir] });

    await expect(catalog.resolveRoot('repoA')).rejects.toBeInstanceOf(RootNotListedError);
    expect(git.repoRootCalls()).toBe(0);
  });

  it('shares one scan between overlapping list() calls', async () => {
    setup();
    const git = fakeGit();
    const catalog = createRepoCatalog({ git, roots: [dir] });

    await Promise.all([catalog.list(), catalog.list()]);

    expect(git.repoRootCalls()).toBe(1); // only repoA has a `.git`, so one candidate is checked
  });

  it('accepts a repo created after the snapshot was built', async () => {
    setup();
    const catalog = createRepoCatalog({ git: fakeGit(), roots: [dir] });
    await catalog.list();

    mkdirSync(join(other, '.git'));

    await expect(catalog.resolveRoot(other)).resolves.toBe(other);
  });

  it('rejects a repo on the next call once its .git is removed, inside the TTL', async () => {
    setup();
    const catalog = createRepoCatalog({ git: fakeGit(), roots: [dir] });
    await catalog.list();
    await expect(catalog.resolveRoot(repoA)).resolves.toBe(repoA);

    rmSync(join(repoA, '.git'), { recursive: true });

    await expect(catalog.resolveRoot(repoA)).rejects.toBeInstanceOf(RootNotListedError);
  });

  it('checks only the requested path instead of scanning every repo', async () => {
    setup();
    for (const name of ['repoB', 'repoC', 'repoD'])
      mkdirSync(join(dir, name, '.git'), { recursive: true });
    mkdirSync(join(repoA, '.worktrees', 'feat'), { recursive: true });
    mkdirSync(join(repoA, '.worktrees', 'feat', '.git'));
    const git = fakeGit();
    const catalog = createRepoCatalog({ git, roots: [dir] });

    await expect(catalog.resolveRoot(join(dir, 'repoC'))).resolves.toBe(join(dir, 'repoC'));
    expect(git.repoRootCalls()).toBe(1);
    expect(git.branchCalls()).toBe(0);

    await catalog.list();
    const afterScan = git.repoRootCalls();
    await catalog.resolveRoot(join(repoA, '.worktrees', 'feat'));
    expect(git.repoRootCalls()).toBe(afterScan + 1); // the worktree's repo, not a rescan
  });

  it('serves list() from the snapshot inside the TTL and rescans after it', async () => {
    setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    const git = fakeGit();
    const catalog = createRepoCatalog({ git, roots: [dir] });

    await catalog.list();
    await catalog.list();
    expect(git.repoRootCalls()).toBe(1);

    vi.setSystemTime(Date.now() + REPO_CACHE_TTL_MS + 1);
    await catalog.list();
    expect(git.repoRootCalls()).toBe(2);
  });
});
