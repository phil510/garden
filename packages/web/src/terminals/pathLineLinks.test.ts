import { describe, expect, it } from 'vitest';
import { findPathLineLinks } from './pathLineLinks';

describe('findPathLineLinks', () => {
  it('finds a relative path with a line number', () => {
    expect(findPathLineLinks('at src/foo.ts:42 in the stack')).toEqual([
      { path: 'src/foo.ts', line: 42, index: 3, length: 13 },
    ]);
  });

  it('finds an absolute path at the start of the text', () => {
    expect(findPathLineLinks('/abs/path/file.py:7')).toEqual([
      { path: '/abs/path/file.py', line: 7, index: 0, length: 19 },
    ]);
  });

  it('ignores a trailing column number', () => {
    const links = findPathLineLinks('foo.ts:10:5');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ path: 'foo.ts', line: 10 });
  });

  it('finds every match on a line', () => {
    const links = findPathLineLinks('src/a.ts:1 and src/b.ts:2');
    expect(links.map((link) => ({ path: link.path, line: link.line }))).toEqual([
      { path: 'src/a.ts', line: 1 },
      { path: 'src/b.ts', line: 2 },
    ]);
  });

  it('ignores a bare word and number with no path shape', () => {
    expect(findPathLineLinks('build finished, npm:1234')).toEqual([]);
  });

  it('ignores a URL host and port', () => {
    expect(findPathLineLinks('visit http://example.com:8080/page for details')).toEqual([]);
  });

  it('returns nothing for plain text', () => {
    expect(findPathLineLinks('all tests passed')).toEqual([]);
  });

  describe('bare paths', () => {
    it('links a relative path with no line number', () => {
      expect(findPathLineLinks('edited src/foo.ts today')).toEqual([
        { path: 'src/foo.ts', line: null, index: 7, length: 10 },
      ]);
    });

    it('links an absolute path', () => {
      expect(findPathLineLinks('/abs/path/file.py')).toEqual([
        { path: '/abs/path/file.py', line: null, index: 0, length: 17 },
      ]);
    });

    it('links a file in the current directory', () => {
      expect(findPathLineLinks('see package.json and README.md').map((l) => l.path)).toEqual([
        'package.json',
        'README.md',
      ]);
    });

    it('leaves a sentence-ending period out of the link', () => {
      expect(findPathLineLinks('see src/foo.ts.')).toEqual([
        { path: 'src/foo.ts', line: null, index: 4, length: 10 },
      ]);
    });

    it('links a path in parentheses or backticks', () => {
      expect(findPathLineLinks('(src/a.ts) `src/b.ts`').map((l) => l.path)).toEqual([
        'src/a.ts',
        'src/b.ts',
      ]);
    });

    it('finds bare and path:line links on one line', () => {
      expect(
        findPathLineLinks('src/a.ts then src/b.ts:3').map((l) => ({ path: l.path, line: l.line })),
      ).toEqual([
        { path: 'src/a.ts', line: null },
        { path: 'src/b.ts', line: 3 },
      ]);
    });

    it.each([
      'all tests passed',
      'fooBar snake_case',
      'store.getState',
      'v1.2.3 and 3.14',
      'Loading...',
      'and/or client/server origin/main 2026/10/09',
      'cd src/components',
      'host:8080',
    ])('does not link %j', (text) => {
      expect(findPathLineLinks(text)).toEqual([]);
    });

    it.each([
      'http://localhost:5173/src/App.tsx',
      'https://x.com/login?next=/a.html',
      'https://x.com/~u/f.md',
      'redirect_uri=https%3A%2F%2Fconsole.anthropic.com',
      'https://github.com/a/b.md',
    ])('does not link inside the URL %j', (text) => {
      expect(findPathLineLinks(text)).toEqual([]);
    });

    it('does not link the start of a wrapped row, but links the same text on a fresh row', () => {
      expect(findPathLineLinks('ers/profile.json', true)).toEqual([]);
      expect(findPathLineLinks('ers/profile.json', false)).toHaveLength(1);
    });
  });
});
