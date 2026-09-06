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
});
