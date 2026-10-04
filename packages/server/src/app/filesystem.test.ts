import { aSession } from '@garden/shared/fixtures';
import type { SessionState } from '@garden/shared';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotADirectoryError,
  NotAFileError,
  PathNotFoundError,
  PathOutsideRootError,
  readFile,
  readTree,
} from './filesystem.js';
import type { GitPort, GitStatusEntry } from './ports.js';
import type { Projection } from './projection.js';
import { REPO_CACHE_TTL_MS, RootNotListedError, createRepoCatalog } from './repoCatalog.js';
import { SessionNotFoundError } from './sessions.js';

type FilesystemGit = Pick<GitPort, 'workTreePrefix' | 'status'>;

function fakeProjection(sessions: SessionState[]): Projection {
  return {
    sessions: () => sessions,
    uiState: () => {
      throw new Error('not used by this test');
    },
    dispatch: () => {
      throw new Error('not used by this test');
    },
    updateUiState: () => {
      throw new Error('not used by this test');
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    overlay: () => {
      throw new Error('not used by this test');
    },
    updateOverlay: () => {
      throw new Error('not used by this test');
    },
    overlay: () => {
      throw new Error('not used by this test');
    },
    subscribeOverlay: () => () => undefined,
    placementOf: () => {
      throw new Error('not used by this test');
    },
  };
}

/** `prefix` is where the session's cwd sits inside the working tree, the way the real adapter
 *  reports it: empty when the cwd is the working tree root, slash-terminated below it. */
function fakeGit(entries: GitStatusEntry[] = [], prefix = ''): FilesystemGit {
  return {
    status: () => Promise.resolve(entries),
    workTreePrefix: () => Promise.resolve(prefix),
  };
}

/** A cwd in no git repo at all: `git rev-parse` fails before any status is asked for. */
function fakeGitOutsideRepo(): FilesystemGit {
  return {
    status: () => Promise.reject(new Error('not a git repository')),
    workTreePrefix: () => Promise.reject(new Error('not a git repository')),
  };
}

/** Session-mode tests never name a root. */
const noRepos = {
  resolveRoot: () => Promise.reject(new Error('not used by this test')),
};

describe('readTree', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('lists the root directory, directories before files, alphabetically within each', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'b.txt'), 'b');
    writeFileSync(join(dir, 'a.txt'), 'a');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readTree(deps, { sessionId: session.id, path: '' });

    expect(result.path).toBe('');
    expect(result.entries).toEqual([
      { name: 'src', path: 'src', kind: 'dir', gitStatus: null },
      { name: 'a.txt', path: 'a.txt', kind: 'file', gitStatus: null },
      { name: 'b.txt', path: 'b.txt', kind: 'file', gitStatus: null },
    ]);
  });

  it('lists a nested directory, with entry paths relative to the session cwd', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
    writeFileSync(join(dir, 'src', 'index.ts'), 'x');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readTree(deps, { sessionId: session.id, path: 'src' });

    expect(result.path).toBe('src');
    expect(result.entries).toEqual([
      { name: 'lib', path: 'src/lib', kind: 'dir', gitStatus: null },
      { name: 'index.ts', path: 'src/index.ts', kind: 'file', gitStatus: null },
    ]);
  });

  it('decorates entries from one git status call, matching a renamed path by its new name', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'changed.txt'), 'x');
    writeFileSync(join(dir, 'new.txt'), 'x');
    const session = aSession({ cwd: dir });
    const deps = {
      projection: fakeProjection([session]),
      repos: noRepos,
      git: fakeGit([
        { path: 'changed.txt', status: ' M' },
        { path: 'new.txt', status: '??' },
      ]),
    };

    const result = await readTree(deps, { sessionId: session.id, path: '' });

    expect(result.entries).toEqual([
      { name: 'changed.txt', path: 'changed.txt', kind: 'file', gitStatus: ' M' },
      { name: 'new.txt', path: 'new.txt', kind: 'file', gitStatus: '??' },
    ]);
  });

  it('decorates entries when the cwd sits below the working tree root', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'changed.txt'), 'x');
    const session = aSession({ cwd: join(dir, 'src') });
    const deps = {
      projection: fakeProjection([session]),
      repos: noRepos,
      git: fakeGit(
        [
          { path: 'src/changed.txt', status: ' M' },
          { path: 'README.md', status: ' M' },
        ],
        'src/',
      ),
    };

    const result = await readTree(deps, { sessionId: session.id, path: '' });

    expect(result.entries).toEqual([
      { name: 'changed.txt', path: 'changed.txt', kind: 'file', gitStatus: ' M' },
    ]);
  });

  it('lists a cwd in no git repo, decorating nothing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'a.txt'), 'a');
    const session = aSession({ cwd: dir });
    const deps = {
      projection: fakeProjection([session]),
      repos: noRepos,
      git: fakeGitOutsideRepo(),
    };

    const result = await readTree(deps, { sessionId: session.id, path: '' });

    expect(result.entries).toEqual([
      { name: 'a.txt', path: 'a.txt', kind: 'file', gitStatus: null },
    ]);
  });

  it('rejects a session whose cwd no longer exists', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const session = aSession({ cwd: join(dir, 'gone') });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    await expect(readTree(deps, { sessionId: session.id, path: '' })).rejects.toBeInstanceOf(
      PathNotFoundError,
    );
  });

  it('rejects a path that climbs above the session cwd with `..`', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    mkdirSync(join(dir, 'child'));
    const session = aSession({ cwd: join(dir, 'child') });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    await expect(readTree(deps, { sessionId: session.id, path: '../' })).rejects.toBeInstanceOf(
      PathOutsideRootError,
    );
  });

  it('rejects a symlink that resolves outside the session cwd', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const root = join(dir, 'root');
    const outside = join(dir, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'shh');
    symlinkSync(outside, join(root, 'escape'));
    const session = aSession({ cwd: root });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    await expect(readTree(deps, { sessionId: session.id, path: 'escape' })).rejects.toBeInstanceOf(
      PathOutsideRootError,
    );
  });

  it('rejects a path that does not exist', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    await expect(readTree(deps, { sessionId: session.id, path: 'nope' })).rejects.toBeInstanceOf(
      PathNotFoundError,
    );
  });

  it('rejects listing a file as if it were a directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'a.txt'), 'a');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    await expect(readTree(deps, { sessionId: session.id, path: 'a.txt' })).rejects.toBeInstanceOf(
      NotADirectoryError,
    );
  });

  it('rejects an unknown session id', async () => {
    const deps = { projection: fakeProjection([]), repos: noRepos, git: fakeGit() };

    await expect(readTree(deps, { sessionId: 'nope', path: '' })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });
});

/** Each `status` call reports a different mark for `a.ts` (` M`, then `A `, ...), so a test can
 *  tell which run a listing was decorated from, not only how many ran. `gate` holds a run open
 *  until released. */
function countingGit(gates: Array<Promise<void>> = []) {
  const marks = [' M', 'A ', 'D '];
  const calls = { status: 0, workTreePrefix: 0 };
  const git: FilesystemGit = {
    workTreePrefix: () => {
      calls.workTreePrefix += 1;
      return Promise.resolve('');
    },
    status: async () => {
      const run = calls.status;
      calls.status += 1;
      await gates[run];
      return [
        { path: 'a.ts', status: marks[run]! },
        { path: 'x/a.ts', status: marks[run]! },
      ];
    },
  };
  return { git, calls };
}

describe('readTree git status per refresh', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function setup(git: FilesystemGit) {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    mkdirSync(join(dir, 'x'));
    mkdirSync(join(dir, 'y'));
    writeFileSync(join(dir, 'a.ts'), 'a');
    writeFileSync(join(dir, 'x', 'a.ts'), 'a');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git };
    const tree = async (path: string, refresh?: string) =>
      (
        await readTree(deps, {
          sessionId: session.id,
          path,
          ...(refresh === undefined ? {} : { refresh }),
        })
      ).entries.find((entry) => entry.name === 'a.ts')?.gitStatus;
    return { tree };
  }

  it('runs git status once for several folders loaded under one refresh', async () => {
    const { git, calls } = countingGit();
    const { tree } = setup(git);

    const served = [await tree('', 'r1'), await tree('x', 'r1'), await tree('y', 'r1')];

    expect(calls).toEqual({ status: 1, workTreePrefix: 1 });
    expect(served).toEqual([' M', ' M', undefined]);
  });

  it('runs git status again for a new refresh and serves its result', async () => {
    const { git, calls } = countingGit();
    const { tree } = setup(git);

    await tree('', 'r1');
    const second = await tree('', 'r2');

    expect(calls.status).toBe(2);
    expect(second).toBe('A ');
  });

  it('serves a new refresh its own run while the previous refresh is still running', async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { git, calls } = countingGit([first]);
    const { tree } = setup(git);

    const stale = tree('', 'r1');
    await vi.waitFor(() => expect(calls.status).toBe(1));
    const fresh = await tree('', 'r2');
    release();

    expect(calls.status).toBe(2);
    expect(fresh).toBe('A ');
    expect(await stale).toBe(' M');
  });

  it('gives a request without a refresh token its own run, joining nothing', async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { git, calls } = countingGit([first]);
    const { tree } = setup(git);

    const tokened = tree('', 'r1');
    await vi.waitFor(() => expect(calls.status).toBe(1));
    const untokened = await tree('');
    release();
    await tokened;
    await tree('');

    expect(calls.status).toBe(3);
    expect(untokened).toBe('A ');
  });
});

describe('readFile', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads a file whole, untruncated', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'a.txt'), 'hello');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readFile(deps, { sessionId: session.id, path: 'a.txt' });

    expect(result).toEqual({ path: 'a.txt', kind: 'text', text: 'hello', truncated: false });
  });

  it('caps the read and reports truncation past the cap', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'big.txt'), '0123456789');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readFile(deps, { sessionId: session.id, path: 'big.txt' }, 4);

    expect(result).toEqual({ path: 'big.txt', kind: 'text', text: '0123', truncated: true });
  });

  it('reads an image file whole and reports it base64-encoded', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(dir, 'pic.png'), bytes);
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readFile(deps, { sessionId: session.id, path: 'pic.png' });

    expect(result).toEqual({
      path: 'pic.png',
      kind: 'image',
      mimeType: 'image/png',
      truncated: false,
      data: bytes.toString('base64'),
    });
  });

  it('reports an oversized image as truncated, with no data', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'big.png'), Buffer.from([1, 2, 3, 4, 5]));
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readFile(deps, { sessionId: session.id, path: 'big.png' }, undefined, 4);

    expect(result).toEqual({
      path: 'big.png',
      kind: 'image',
      mimeType: 'image/png',
      truncated: true,
    });
  });

  it('classifies a NUL-containing, non-image file as binary', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'data.bin'), Buffer.from([0x41, 0x00, 0x42]));
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readFile(deps, { sessionId: session.id, path: 'data.bin' });

    expect(result).toEqual({ path: 'data.bin', kind: 'binary' });
  });

  it('classifies an SVG as an image by extension, not sniffed as text', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'icon.svg'), '<svg></svg>');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readFile(deps, { sessionId: session.id, path: 'icon.svg' });

    expect(result).toEqual({
      path: 'icon.svg',
      kind: 'image',
      mimeType: 'image/svg+xml',
      truncated: false,
      data: Buffer.from('<svg></svg>').toString('base64'),
    });
  });

  it('rejects a symlink that resolves outside the session cwd', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const root = join(dir, 'root');
    const outside = join(dir, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'shh');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt'));
    const session = aSession({ cwd: root });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    await expect(
      readFile(deps, { sessionId: session.id, path: 'escape.txt' }),
    ).rejects.toBeInstanceOf(PathOutsideRootError);
  });

  it('resolves a symlink that stays within the session cwd', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'real.txt'), 'hi');
    symlinkSync(join(dir, 'real.txt'), join(dir, 'alias.txt'));
    const session = aSession({ cwd: realpathSync(dir) });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    const result = await readFile(deps, { sessionId: session.id, path: 'alias.txt' });

    expect(result).toEqual({ path: 'alias.txt', kind: 'text', text: 'hi', truncated: false });
  });

  it('rejects reading a directory as if it were a file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    mkdirSync(join(dir, 'sub'));
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), repos: noRepos, git: fakeGit() };

    await expect(readFile(deps, { sessionId: session.id, path: 'sub' })).rejects.toBeInstanceOf(
      NotAFileError,
    );
  });

  it('rejects an unknown session id', async () => {
    const deps = { projection: fakeProjection([]), repos: noRepos, git: fakeGit() };

    await expect(readFile(deps, { sessionId: 'nope', path: 'a.txt' })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });
});

describe('root-keyed resolution', () => {
  let dir: string;
  let roots: string;
  let repoA: string;
  let repoB: string;
  let notARepo: string;

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  /** `<tmp>/roots/{repoA,repoB}` are repos (a `.git` on disk); `notARepo` is a sibling that
   *  is not. */
  function setup() {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-fs-root-')));
    roots = join(dir, 'roots');
    repoA = join(roots, 'repoA');
    repoB = join(roots, 'repoB');
    notARepo = join(roots, 'notARepo');
    for (const path of [repoA, repoB, notARepo]) mkdirSync(path, { recursive: true });
    mkdirSync(join(repoA, '.git'));
    mkdirSync(join(repoB, '.git'));
    mkdirSync(join(repoA, 'src'));
    writeFileSync(join(repoA, 'src', 'x.ts'), 'x');
    writeFileSync(join(repoB, 'secret.txt'), 'in B');
    writeFileSync(join(notARepo, 'n.txt'), 'in N');
  }

  /** Treats a directory as a repo while it has a `.git` entry on disk, and reports its
   *  realpath as the toplevel the way `git rev-parse` does. */
  const repoGit: Pick<GitPort, 'repoRoot' | 'branch'> = {
    repoRoot: (cwd) => {
      try {
        realpathSync(join(cwd, '.git'));
        return Promise.resolve(realpathSync(cwd));
      } catch {
        return Promise.reject(new Error(`not a git repository: ${cwd}`));
      }
    },
    branch: () => Promise.resolve('main'),
  };

  function depsFor(configuredRoot: string = roots) {
    return {
      projection: fakeProjection([]),
      git: fakeGit(),
      repos: createRepoCatalog({ git: repoGit, roots: [configuredRoot] }),
    };
  }

  it('lists and reads under a listed root, with paths relative to it', async () => {
    setup();
    const deps = depsFor();

    const tree = await readTree(deps, { root: repoA, path: 'src' });
    const file = await readFile(deps, { root: repoA, path: 'src/x.ts' });

    expect(tree.path).toBe('src');
    expect(tree.entries).toEqual([
      { name: 'x.ts', path: 'src/x.ts', kind: 'file', gitStatus: null },
    ]);
    expect(file).toEqual({ path: 'src/x.ts', kind: 'text', text: 'x', truncated: false });
  });

  it('gives the same tree for a root as for a session at that directory', async () => {
    setup();
    const deps = depsFor();
    const session = aSession({ cwd: repoA });
    const sessionDeps = { ...deps, projection: fakeProjection([session]) };

    expect(await readTree(deps, { root: repoA, path: '' })).toEqual(
      await readTree(sessionDeps, { sessionId: session.id, path: '' }),
    );
  });

  describe('rejects a root that is not a listed repo', () => {
    it('never listed', async () => {
      setup();
      const unrelated = mkdtempSync(join(tmpdir(), 'garden-fs-unrelated-'));
      try {
        await expect(readTree(depsFor(), { root: unrelated, path: '' })).rejects.toBeInstanceOf(
          RootNotListedError,
        );
      } finally {
        rmSync(unrelated, { recursive: true, force: true });
      }
    });

    it('the parent of a listed root', async () => {
      setup();
      await expect(readTree(depsFor(), { root: roots, path: '' })).rejects.toBeInstanceOf(
        RootNotListedError,
      );
    });

    it('a sibling under the configured root that is not a repo', async () => {
      setup();
      await expect(readFile(depsFor(), { root: notARepo, path: 'n.txt' })).rejects.toBeInstanceOf(
        RootNotListedError,
      );
    });

    it('a subdirectory of a listed repo', async () => {
      setup();
      await expect(
        readTree(depsFor(), { root: join(repoA, 'src'), path: '' }),
      ).rejects.toBeInstanceOf(RootNotListedError);
    });

    it('a relative spelling of a listed root', async () => {
      setup();
      const relativeRepo = relative(process.cwd(), repoA);
      await expect(readTree(depsFor(), { root: relativeRepo, path: '' })).rejects.toBeInstanceOf(
        RootNotListedError,
      );
    });

    it('a path that does not exist', async () => {
      setup();
      await expect(
        readTree(depsFor(), { root: join(roots, 'nope'), path: '' }),
      ).rejects.toBeInstanceOf(RootNotListedError);
    });
  });

  describe('a root that was listed and is then removed', () => {
    it('is rejected at once when its directory is deleted', async () => {
      setup();
      const deps = depsFor();
      await readTree(deps, { root: repoA, path: '' });

      rmSync(repoA, { recursive: true });

      await expect(readTree(deps, { root: repoA, path: '' })).rejects.toBeInstanceOf(
        RootNotListedError,
      );
    });

    it('is accepted until the cache expires, then rejected once it stops being a repo', async () => {
      setup();
      vi.useFakeTimers({ toFake: ['Date'] });
      const deps = depsFor();
      await readTree(deps, { root: repoA, path: '' });

      rmSync(join(repoA, '.git'), { recursive: true });
      await expect(readTree(deps, { root: repoA, path: '' })).resolves.toBeDefined();

      vi.setSystemTime(Date.now() + REPO_CACHE_TTL_MS + 1);
      await expect(readTree(deps, { root: repoA, path: '' })).rejects.toBeInstanceOf(
        RootNotListedError,
      );
    });
  });

  describe('symlinks', () => {
    it('a symlink to a listed repo is accepted and reads the same as the real path', async () => {
      setup();
      const link = join(dir, 'link-to-A');
      symlinkSync(repoA, link);
      const deps = depsFor();

      expect(await readTree(deps, { root: link, path: '' })).toEqual(
        await readTree(deps, { root: repoA, path: '' }),
      );
    });

    it('a symlinked configured root accepts a repo by either spelling', async () => {
      setup();
      const linkedRoots = join(dir, 'linked-roots');
      symlinkSync(roots, linkedRoots);
      const deps = depsFor(linkedRoots);

      await expect(readTree(deps, { root: repoA, path: '' })).resolves.toBeDefined();
      await expect(
        readTree(deps, { root: join(linkedRoots, 'repoA'), path: '' }),
      ).resolves.toBeDefined();
    });

    it('a symlink to a non-repo is rejected like the real path', async () => {
      setup();
      const link = join(dir, 'link-to-N');
      symlinkSync(notARepo, link);

      await expect(readTree(depsFor(), { root: link, path: '' })).rejects.toBeInstanceOf(
        RootNotListedError,
      );
    });
  });

  describe('under an accepted root, rejects', () => {
    it('`..` traversal', async () => {
      setup();
      const deps = depsFor();
      await expect(
        readFile(deps, { root: repoA, path: '../repoB/secret.txt' }),
      ).rejects.toBeInstanceOf(PathOutsideRootError);
      await expect(readTree(deps, { root: repoA, path: '../repoB' })).rejects.toBeInstanceOf(
        PathOutsideRootError,
      );
    });

    // `join` nests an absolute path under the root, so it is looked up there (and not found)
    // instead of reaching the real file it names.
    it('an absolute path', async () => {
      setup();
      const deps = depsFor();
      await expect(
        readFile(deps, { root: repoA, path: join(repoB, 'secret.txt') }),
      ).rejects.toBeInstanceOf(PathNotFoundError);
      await expect(readTree(deps, { root: repoA, path: repoB })).rejects.toBeInstanceOf(
        PathNotFoundError,
      );
    });

    it('a symlink whose target escapes', async () => {
      setup();
      symlinkSync(join(repoB, 'secret.txt'), join(repoA, 'escape.txt'));
      symlinkSync(repoB, join(repoA, 'escape'));
      const deps = depsFor();
      await expect(readFile(deps, { root: repoA, path: 'escape.txt' })).rejects.toBeInstanceOf(
        PathOutsideRootError,
      );
      await expect(readTree(deps, { root: repoA, path: 'escape' })).rejects.toBeInstanceOf(
        PathOutsideRootError,
      );
    });
  });

  it('rejects an absolute path under a session cwd', async () => {
    setup();
    const session = aSession({ cwd: repoA });
    const deps = { ...depsFor(), projection: fakeProjection([session]) };

    await expect(
      readFile(deps, { sessionId: session.id, path: join(repoB, 'secret.txt') }),
    ).rejects.toBeInstanceOf(PathNotFoundError);
  });
});
