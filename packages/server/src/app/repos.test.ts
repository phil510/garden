import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GitPort } from './ports.js';
import { isListedPath, listRepos } from './repos.js';

/**
 * Fakes `GitPort` by directory: a path with no entry in `roots` fails `repoRoot` exactly as a
 * non-git directory would, a path with no entry in `branches` fails `branch` exactly as a
 * repo with no commits yet would, and only the paths in `bare` are bare repositories. `roots`' values must already be resolved (`realpathSync`),
 * the way the real adapter's `git rev-parse` output always is — the tests build them that way
 * so the fake matches real behaviour on a filesystem where the temp directory itself sits
 * behind a symlink (macOS's `/var` for one).
 */
function fakeGit(
  roots: Record<string, string>,
  branches: Record<string, string> = {},
  bare: readonly string[] = [],
): Pick<GitPort, 'repoRoot' | 'isBareRepository' | 'branch'> {
  return {
    repoRoot: (cwd) => {
      const root = roots[cwd];
      return root === undefined
        ? Promise.reject(new Error(`not a git repository: ${cwd}`))
        : Promise.resolve(root);
    },
    isBareRepository: (cwd) => Promise.resolve(bare.includes(cwd)),
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

/** A `.git` file rather than a directory: the shape of a linked worktree, of a bare clone's
 *  directory, and of a repo made with `--separate-git-dir`. */
function markAsGitLink(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.git'), 'gitdir: /elsewhere\n');
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

  it('does not descend into a worktree looking for worktrees nested inside it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoF');
    const worktree = join(repo, '.worktrees', 'feat-x');
    // A `.git` two levels inside the already-found worktree — reachable only if the recursion
    // boundary in walk failed to stop once `feat-x` itself was identified as a worktree.
    const nestedGitDir = join(worktree, 'vendor', 'nested-repo');
    mkdirSync(nestedGitDir, { recursive: true });
    markAsGitDir(repo);
    markAsGitDir(worktree);
    markAsGitDir(nestedGitDir);
    const resolvedRepo = realpathSync(repo);
    const git = fakeGit(
      {
        [repo]: resolvedRepo,
        [worktree]: resolvedRepo,
        [nestedGitDir]: realpathSync(nestedGitDir),
      },
      { [repo]: 'main', [worktree]: 'feat/x', [nestedGitDir]: 'main' },
    );

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos).toEqual([
      { path: repo, name: 'repoF', branch: 'main', isWorktree: false },
      { path: worktree, name: 'feat-x', branch: 'feat/x', isWorktree: true },
    ]);
  });

  it('bounds concurrent git spawns while still running them in parallel', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repoCount = 20;
    const repoPaths: string[] = [];
    for (let i = 0; i < repoCount; i += 1) {
      const repo = join(dir, `repo${i}`);
      mkdirSync(repo, { recursive: true });
      markAsGitDir(repo);
      repoPaths.push(repo);
    }

    let inFlight = 0;
    let peakInFlight = 0;

    /** Resolves on a macrotask instead of synchronously, so several calls can genuinely
     *  overlap in flight — a fake that settles immediately (like `fakeGit` above) could never
     *  show more than one call in flight regardless of whether the caller bounds concurrency. */
    function gated<T>(result: () => T): Promise<T> {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve(result());
        }, 5);
      });
    }

    const roots = Object.fromEntries(repoPaths.map((repo) => [repo, realpathSync(repo)]));
    const branches = Object.fromEntries(repoPaths.map((repo) => [repo, 'main']));
    const git: Pick<GitPort, 'repoRoot' | 'isBareRepository' | 'branch'> = {
      repoRoot: (cwd) =>
        roots[cwd] === undefined
          ? Promise.reject(new Error(`not a git repository: ${cwd}`))
          : gated(() => roots[cwd]!),
      isBareRepository: () => Promise.resolve(false),
      branch: (cwd) =>
        branches[cwd] === undefined
          ? Promise.reject(new Error(`no branch: ${cwd}`))
          : gated(() => branches[cwd]!),
    };

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos).toHaveLength(repoCount);
    // The bound holds (never more in flight than the limiter allows) and fan-out is real
    // (more than one in flight at once) — either assertion alone can't tell correctly-bounded
    // concurrent code apart from unchanged sequential code.
    expect(peakInFlight).toBeLessThanOrEqual(8);
    expect(peakInFlight).toBeGreaterThan(1);
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

describe('listRepos with a bare clone', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('lists the worktrees checked out beside the clone, nested by branch segments', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoG');
    const main = join(repo, 'main');
    const nested = join(repo, 'feat', 'y');
    markAsGitLink(repo);
    mkdirSync(join(repo, '.bare', 'worktrees', 'main'), { recursive: true });
    markAsGitLink(main);
    markAsGitLink(nested);
    // Hidden directories beside the clone are never worktrees, whatever they hold.
    markAsGitLink(join(repo, '.claude'));
    const resolvedRepo = realpathSync(repo);
    const git = fakeGit(
      { [repo]: resolvedRepo, [main]: resolvedRepo, [nested]: resolvedRepo },
      { [repo]: 'main', [main]: 'main', [nested]: 'feat/y' },
      [repo],
    );

    const repos = await listRepos({ git, roots: [dir] });

    // Siblings come back in directory-listing order, which only some filesystems sort.
    expect(repos.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: repo, name: 'repoG', branch: 'main', isWorktree: false },
      { path: nested, name: 'y', branch: 'feat/y', isWorktree: true },
      { path: main, name: 'main', branch: 'main', isWorktree: true },
    ]);
  });

  it('lists neither an independent clone beside the clone nor a hidden directory below the first level', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoI');
    const nested = join(repo, 'feat', 'y');
    markAsGitLink(repo);
    mkdirSync(join(repo, '.bare'), { recursive: true });
    markAsGitLink(nested);
    markAsGitLink(join(repo, 'feat', '.cache'));
    // An independent clone has a `.git` directory, and nothing inside it is a worktree.
    mkdirSync(join(repo, 'scratch-clone', '.git'), { recursive: true });
    markAsGitLink(join(repo, 'scratch-clone', 'inner'));
    const resolvedRepo = realpathSync(repo);
    const git = fakeGit(
      { [repo]: resolvedRepo, [nested]: resolvedRepo },
      { [repo]: 'main', [nested]: 'feat/y' },
      [repo],
    );

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: repo, name: 'repoI', branch: 'main', isWorktree: false },
      { path: nested, name: 'y', branch: 'feat/y', isWorktree: true },
    ]);
  });

  it('stays out of a repo whose .git file points at a git dir that is not bare', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-repos-'));
    const repo = join(dir, 'repoH');
    markAsGitLink(repo);
    // A submodule in the working tree has a `.git` file too.
    markAsGitLink(join(repo, 'vendor', 'lib'));
    const git = fakeGit({ [repo]: realpathSync(repo) }, { [repo]: 'main' });

    const repos = await listRepos({ git, roots: [dir] });

    expect(repos).toEqual([{ path: repo, name: 'repoH', branch: 'main', isWorktree: false }]);
  });
});

const BARE_GITLINK = 'gitdir: ./.bare\n';

describe('isListedPath', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** Answers from what is on disk, as git does: a `.git` directory makes `cwd` its own repo
   *  root, a gitlink to `./.bare` makes it a bare clone's directory and so its own root too, and
   *  any other `.git` file (a worktree's gitlink) points at some other repo. */
  function diskGit(): Pick<GitPort, 'repoRoot' | 'isBareRepository' | 'branch'> {
    return {
      repoRoot: (cwd) => {
        try {
          const real = realpathSync(cwd);
          const isDir = statSync(join(real, '.git')).isDirectory();
          return Promise.resolve(isDir || holdsBareClone(real) ? real : '/elsewhere');
        } catch {
          return Promise.reject(new Error(`not a git repository: ${cwd}`));
        }
      },
      isBareRepository: (cwd) => Promise.resolve(holdsBareClone(cwd)),
      branch: () => Promise.resolve('main'),
    };
  }

  function holdsBareClone(path: string): boolean {
    try {
      return readFileSync(join(path, '.git'), 'utf8') === BARE_GITLINK;
    } catch {
      return false;
    }
  }

  function tempRoot(): string {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-listed-')));
    return dir;
  }

  function repo(path: string): void {
    mkdirSync(join(path, '.git'), { recursive: true });
  }

  function worktree(path: string): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, '.git'), 'gitdir: /elsewhere\n');
  }

  function bareClone(path: string): void {
    mkdirSync(join(path, '.bare'), { recursive: true });
    writeFileSync(join(path, '.git'), BARE_GITLINK);
  }

  it('accepts a repo, single-segment and nested worktrees, and a repo named like a parent ref', async () => {
    const root = tempRoot();
    repo(join(root, 'repoA'));
    worktree(join(root, 'repoA', '.worktrees', 'one'));
    worktree(join(root, 'repoA', '.worktrees', 'feat', 'x'));
    repo(join(root, '..foo'));
    bareClone(join(root, 'repoC'));
    worktree(join(root, 'repoC', 'main'));
    worktree(join(root, 'repoC', 'feat', 'x'));
    const deps = { git: diskGit(), roots: [root] };

    for (const accepted of [
      join(root, 'repoA'),
      join(root, 'repoA', '.worktrees', 'one'),
      join(root, 'repoA', '.worktrees', 'feat', 'x'),
      join(root, '..foo'),
      join(root, 'repoC'),
      join(root, 'repoC', 'main'),
      join(root, 'repoC', 'feat', 'x'),
    ]) {
      expect(await isListedPath(deps, accepted), accepted).toBe(true);
    }
  });

  it('accepts a repo reached through a symlinked configured root', async () => {
    const root = tempRoot();
    repo(join(root, 'real', 'repoA'));
    symlinkSync(join(root, 'real'), join(root, 'linked'));
    const deps = { git: diskGit(), roots: [join(root, 'linked')] };

    expect(await isListedPath(deps, join(root, 'real', 'repoA'))).toBe(true);
  });

  it('skips a configured root that does not exist and still checks the others', async () => {
    const root = tempRoot();
    repo(join(root, 'repoA'));
    const deps = { git: diskGit(), roots: [join(root, 'missing'), root] };

    expect(await isListedPath(deps, join(root, 'repoA'))).toBe(true);
  });

  it('rejects paths that are not a repo or worktree directly under a root', async () => {
    const root = tempRoot();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'garden-outside-')));
    try {
      repo(join(outside, 'repoO'));
      repo(join(root, 'repoA'));
      mkdirSync(join(root, 'repoA', 'src'));
      worktree(join(root, 'repoA', '.worktrees', 'one'));
      mkdirSync(join(root, 'repoA', '.worktrees', 'bare'));
      mkdirSync(join(root, 'plain'));
      mkdirSync(join(root, 'plain', '.worktrees', 'x'), { recursive: true });
      worktree(join(root, 'plain', '.worktrees', 'x'));
      worktree(join(root, 'stray'));
      worktree(join(root, 'repoA', '.worktrees', 'one', 'inner'));
      bareClone(join(root, 'repoC'));
      worktree(join(root, 'repoC', 'main'));
      worktree(join(root, 'repoC', '.hidden'));
      worktree(join(root, 'repoC', 'feat', '.cache'));
      repo(join(root, 'repoC', 'scratch-clone'));
      mkdirSync(join(root, 'repoC', 'feat'), { recursive: true });
      const deps = { git: diskGit(), roots: [root] };

      for (const rejected of [
        join(outside, 'repoO'),
        root,
        join(root, 'plain'),
        join(root, 'repoA', 'src'),
        join(root, 'stray'),
        join(root, 'repoA', '.worktrees'),
        join(root, 'repoA', '.worktrees', 'bare'),
        join(root, 'repoA', '.worktrees', 'one', 'inner'),
        join(root, 'plain', '.worktrees', 'x'),
        join(root, 'nonexistent'),
        join(root, 'repoC', '.bare'),
        join(root, 'repoC', '.hidden'),
        join(root, 'repoC', 'feat'),
        join(root, 'repoC', 'feat', '.cache'),
        join(root, 'repoC', 'scratch-clone'),
      ]) {
        expect(await isListedPath(deps, rejected), rejected).toBe(false);
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('agrees with listRepos on every directory in the tree', async () => {
    const root = tempRoot();
    repo(join(root, 'repoA'));
    worktree(join(root, 'repoA', '.worktrees', 'one'));
    worktree(join(root, 'repoA', '.worktrees', 'feat', 'x'));
    mkdirSync(join(root, 'repoA', '.worktrees', 'bare'));
    mkdirSync(join(root, 'repoA', 'other'));
    worktree(join(root, 'repoA', 'other', 'looks-like-a-worktree'));
    worktree(join(root, 'repoA', '.worktrees', 'one', '.worktrees', 'nested'));
    repo(join(root, 'repoA', '.worktrees', 'one', 'vendor', 'inner'));
    repo(join(root, 'org', 'deep'));
    mkdirSync(join(root, 'plain', '.worktrees', 'x'), { recursive: true });
    worktree(join(root, 'plain', '.worktrees', 'x'));
    worktree(join(root, 'stray'));
    repo(join(root, 'repoB'));
    repo(join(root, '..foo'));
    bareClone(join(root, 'repoC'));
    worktree(join(root, 'repoC', 'main'));
    worktree(join(root, 'repoC', 'feat', 'x'));
    worktree(join(root, 'repoC', '.hidden'));
    worktree(join(root, 'repoC', 'feat', '.cache'));
    repo(join(root, 'repoC', 'scratch-clone'));
    worktree(join(root, 'repoC', 'scratch-clone', 'inner'));
    mkdirSync(join(root, 'repoC', '.bare', 'worktrees', 'main'), { recursive: true });
    const deps = { git: diskGit(), roots: [root] };
    const listed = new Set((await listRepos(deps)).map((entry) => realpathSync(entry.path)));

    const directories: string[] = [root];
    for (let i = 0; i < directories.length; i += 1) {
      const current = directories[i] as string;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== '.git')
          directories.push(join(current, entry.name));
      }
    }

    expect(listed.size).toBeGreaterThan(4);
    for (const candidate of directories) {
      expect(await isListedPath(deps, candidate), candidate).toBe(listed.has(candidate));
    }
  });
});
