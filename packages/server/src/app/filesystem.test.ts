import { aSession } from '@garden/shared/fixtures';
import type { SessionState } from '@garden/shared';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NotADirectoryError,
  NotAFileError,
  PathNotFoundError,
  PathOutsideRootError,
  readSessionFile,
  readSessionTree,
} from './filesystem.js';
import type { GitPort, GitStatusEntry } from './ports.js';
import type { Projection } from './projection.js';
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

describe('readSessionTree', () => {
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
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionTree(deps, { sessionId: session.id, path: '' });

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
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionTree(deps, { sessionId: session.id, path: 'src' });

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
      git: fakeGit([
        { path: 'changed.txt', status: ' M' },
        { path: 'new.txt', status: '??' },
      ]),
    };

    const result = await readSessionTree(deps, { sessionId: session.id, path: '' });

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
      git: fakeGit(
        [
          { path: 'src/changed.txt', status: ' M' },
          { path: 'README.md', status: ' M' },
        ],
        'src/',
      ),
    };

    const result = await readSessionTree(deps, { sessionId: session.id, path: '' });

    expect(result.entries).toEqual([
      { name: 'changed.txt', path: 'changed.txt', kind: 'file', gitStatus: ' M' },
    ]);
  });

  it('lists a cwd in no git repo, decorating nothing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'a.txt'), 'a');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), git: fakeGitOutsideRepo() };

    const result = await readSessionTree(deps, { sessionId: session.id, path: '' });

    expect(result.entries).toEqual([
      { name: 'a.txt', path: 'a.txt', kind: 'file', gitStatus: null },
    ]);
  });

  it('rejects a session whose cwd no longer exists', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const session = aSession({ cwd: join(dir, 'gone') });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    await expect(readSessionTree(deps, { sessionId: session.id, path: '' })).rejects.toBeInstanceOf(
      PathNotFoundError,
    );
  });

  it('rejects a path that climbs above the session cwd with `..`', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    mkdirSync(join(dir, 'child'));
    const session = aSession({ cwd: join(dir, 'child') });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    await expect(
      readSessionTree(deps, { sessionId: session.id, path: '../' }),
    ).rejects.toBeInstanceOf(PathOutsideRootError);
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
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    await expect(
      readSessionTree(deps, { sessionId: session.id, path: 'escape' }),
    ).rejects.toBeInstanceOf(PathOutsideRootError);
  });

  it('rejects a path that does not exist', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    await expect(
      readSessionTree(deps, { sessionId: session.id, path: 'nope' }),
    ).rejects.toBeInstanceOf(PathNotFoundError);
  });

  it('rejects listing a file as if it were a directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'a.txt'), 'a');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    await expect(
      readSessionTree(deps, { sessionId: session.id, path: 'a.txt' }),
    ).rejects.toBeInstanceOf(NotADirectoryError);
  });

  it('rejects an unknown session id', async () => {
    const deps = { projection: fakeProjection([]), git: fakeGit() };

    await expect(readSessionTree(deps, { sessionId: 'nope', path: '' })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });
});

describe('readSessionFile', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads a file whole, untruncated', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'a.txt'), 'hello');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionFile(deps, { sessionId: session.id, path: 'a.txt' });

    expect(result).toEqual({ path: 'a.txt', kind: 'text', text: 'hello', truncated: false });
  });

  it('caps the read and reports truncation past the cap', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'big.txt'), '0123456789');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionFile(deps, { sessionId: session.id, path: 'big.txt' }, 4);

    expect(result).toEqual({ path: 'big.txt', kind: 'text', text: '0123', truncated: true });
  });

  it('reads an image file whole and reports it base64-encoded', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(dir, 'pic.png'), bytes);
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionFile(deps, { sessionId: session.id, path: 'pic.png' });

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
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionFile(
      deps,
      { sessionId: session.id, path: 'big.png' },
      undefined,
      4,
    );

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
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionFile(deps, { sessionId: session.id, path: 'data.bin' });

    expect(result).toEqual({ path: 'data.bin', kind: 'binary' });
  });

  it('classifies an SVG as an image by extension, not sniffed as text', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'icon.svg'), '<svg></svg>');
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionFile(deps, { sessionId: session.id, path: 'icon.svg' });

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
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    await expect(
      readSessionFile(deps, { sessionId: session.id, path: 'escape.txt' }),
    ).rejects.toBeInstanceOf(PathOutsideRootError);
  });

  it('resolves a symlink that stays within the session cwd', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    writeFileSync(join(dir, 'real.txt'), 'hi');
    symlinkSync(join(dir, 'real.txt'), join(dir, 'alias.txt'));
    const session = aSession({ cwd: realpathSync(dir) });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    const result = await readSessionFile(deps, { sessionId: session.id, path: 'alias.txt' });

    expect(result).toEqual({ path: 'alias.txt', kind: 'text', text: 'hi', truncated: false });
  });

  it('rejects reading a directory as if it were a file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'garden-fs-'));
    mkdirSync(join(dir, 'sub'));
    const session = aSession({ cwd: dir });
    const deps = { projection: fakeProjection([session]), git: fakeGit() };

    await expect(
      readSessionFile(deps, { sessionId: session.id, path: 'sub' }),
    ).rejects.toBeInstanceOf(NotAFileError);
  });

  it('rejects an unknown session id', async () => {
    const deps = { projection: fakeProjection([]), git: fakeGit() };

    await expect(
      readSessionFile(deps, { sessionId: 'nope', path: 'a.txt' }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});
