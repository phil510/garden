import { describe, expect, it } from 'vitest';
import { parseHead } from './git.js';

describe('parseHead', () => {
  it('reads a branch name out of a symbolic ref, slashes included', () => {
    expect(parseHead('ref: refs/heads/main\n')).toBe('main');
    expect(parseHead('ref: refs/heads/feat/287-branch-head-read\n')).toBe(
      'feat/287-branch-head-read',
    );
  });

  it('accepts a HEAD file without a trailing newline', () => {
    expect(parseHead('ref: refs/heads/main')).toBe('main');
  });

  it('reports a detached HEAD the way rev-parse --abbrev-ref does, for either hash length', () => {
    expect(parseHead(`${'a1'.repeat(20)}\n`)).toBe('HEAD');
    expect(parseHead(`${'b2'.repeat(32)}\n`)).toBe('HEAD');
  });

  it.each([
    ['reftable placeholder', 'ref: refs/heads/.invalid\n'],
    ['symbolic ref outside refs/heads', 'ref: refs/remotes/origin/main\n'],
    ['symbolic ref with no name', 'ref: refs/heads/\n'],
    ['abbreviated object id', 'a1b2c3d\n'],
    ['uppercase object id', `${'A1'.repeat(20)}\n`],
    ['empty file', ''],
    ['partially written file', 'ref: refs/he'],
  ])('leaves %s to git', (_label, contents) => {
    expect(parseHead(contents)).toBeNull();
  });
});
