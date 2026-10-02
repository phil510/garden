import type { RepoEntry } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import {
  isWithin,
  mostSpecificEntry,
  normalizePath,
  relativeTo,
  resolveAgainst,
  resolvePathLineTarget,
} from './projectPaths';

const entry = (path: string, isWorktree = false): RepoEntry => ({
  path,
  name: path.split('/').pop() ?? path,
  branch: null,
  isWorktree,
});

const main = entry('/work/app');
const worktree = entry('/work/app/.worktrees/feat', true);
const sibling = entry('/work/lib');
const repos = [main, worktree, sibling];

describe('normalizePath', () => {
  it('collapses dots, parent segments and repeated separators', () => {
    expect(normalizePath('/a//b/./c/../d/')).toBe('/a/b/d');
  });

  it('drops a parent segment that would climb past the root', () => {
    expect(normalizePath('/../a')).toBe('/a');
  });
});

describe('resolveAgainst', () => {
  it('keeps an absolute path, normalized', () => {
    expect(resolveAgainst('/cwd', '/a/b/../c')).toBe('/a/c');
  });

  it('joins a relative path to the cwd', () => {
    expect(resolveAgainst('/work/app/src', '../lib/x.ts')).toBe('/work/app/lib/x.ts');
  });
});

describe('isWithin', () => {
  it('treats equal paths as contained', () => {
    expect(isWithin('/a/foo', '/a/foo')).toBe(true);
  });

  it('contains descendants', () => {
    expect(isWithin('/a/foo', '/a/foo/bar/baz')).toBe(true);
  });

  it('does not match a sibling that shares a string prefix', () => {
    expect(isWithin('/a/foo', '/a/foobar')).toBe(false);
  });

  it('contains everything under the filesystem root', () => {
    expect(isWithin('/', '/a')).toBe(true);
  });
});

describe('mostSpecificEntry', () => {
  it('picks a worktree over its main repo', () => {
    expect(mostSpecificEntry(repos, '/work/app/.worktrees/feat/src')).toBe(worktree);
  });

  it('picks the repo for a path in one of its subdirectories', () => {
    expect(mostSpecificEntry(repos, '/work/app/packages/x')).toBe(main);
  });

  it('returns null when no entry contains the path', () => {
    expect(mostSpecificEntry(repos, '/elsewhere')).toBeNull();
  });

  it('does not match a sibling directory sharing a prefix', () => {
    expect(mostSpecificEntry([entry('/a/foo')], '/a/foobar')).toBeNull();
  });
});

describe('relativeTo', () => {
  it('returns an empty string for the root itself', () => {
    expect(relativeTo('/a/b', '/a/b')).toBe('');
  });

  it('returns a slash-joined root-relative path', () => {
    expect(relativeTo('/a/b', '/a/b/c/d.ts')).toBe('c/d.ts');
  });
});

describe('resolvePathLineTarget', () => {
  it('re-expresses a relative path from a project subdirectory root-relative', () => {
    expect(resolvePathLineTarget(repos, '/work/app/packages/x', 's1', 'src/a.ts', 5)).toEqual({
      kind: 'root',
      root: '/work/app',
      path: 'packages/x/src/a.ts',
      line: 5,
    });
  });

  it('opens an absolute path inside a listed project there', () => {
    expect(resolvePathLineTarget(repos, '/tmp', 's1', '/work/lib/index.ts', null)).toEqual({
      kind: 'root',
      root: '/work/lib',
      path: 'index.ts',
      line: null,
    });
  });

  it('opens a parent-relative path that lands in another listed project there', () => {
    expect(resolvePathLineTarget(repos, '/work/app/src', 's1', '../../lib/x.ts', 3)).toEqual({
      kind: 'root',
      root: '/work/lib',
      path: 'x.ts',
      line: 3,
    });
  });

  it('prefers the worktree over the main repo containing it', () => {
    const target = resolvePathLineTarget(repos, '/work/app/.worktrees/feat', 's1', 'a.ts', 1);
    expect(target).toMatchObject({ kind: 'root', root: worktree.path, path: 'a.ts' });
  });

  it('falls back to the session route when only the session cwd contains the path', () => {
    expect(resolvePathLineTarget(repos, '/scratch/proj', 's1', 'src/a.ts', 9)).toEqual({
      kind: 'session',
      sessionId: 's1',
      path: 'src/a.ts',
      line: 9,
    });
  });

  it('returns null for a path outside every project and the session cwd', () => {
    expect(resolvePathLineTarget(repos, '/scratch/proj', 's1', '/etc/hosts', 1)).toBeNull();
  });
});
