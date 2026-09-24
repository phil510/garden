import { describe, expect, it } from 'vitest';
import { findMarkdownLinks } from './markdownLinks';

describe('findMarkdownLinks', () => {
  it('finds a well-formed markdown link', () => {
    expect(findMarkdownLinks('see [the docs](https://example.com/) now')).toEqual([
      { url: 'https://example.com/', index: 5, length: 8 },
    ]);
  });

  it('finds every markdown link on a line, with independent offsets', () => {
    const links = findMarkdownLinks('[a](https://a.example/) and [bee](https://b.example/)');
    expect(links).toEqual([
      { url: 'https://a.example/', index: 1, length: 1 },
      { url: 'https://b.example/', index: 29, length: 3 },
    ]);
  });

  it('ignores a bare bracketed span with no trailing (url)', () => {
    expect(findMarkdownLinks('see [the docs] for more')).toEqual([]);
  });

  it('ignores a bracketed span separated from (url) by a space', () => {
    expect(findMarkdownLinks('see [the docs] (https://example.com/) now')).toEqual([]);
  });

  it('ignores unbalanced nested brackets', () => {
    expect(findMarkdownLinks('[a [b] c](https://example.com/)')).toEqual([]);
  });

  it('ignores an unbalanced bracket missing its close', () => {
    expect(findMarkdownLinks('[text(https://example.com/)')).toEqual([]);
  });

  it('matches only the real link when a plain bracket span precedes it on the same line', () => {
    expect(findMarkdownLinks('[foo] and [bar](https://example.com/)')).toEqual([
      { url: 'https://example.com/', index: 11, length: 3 },
    ]);
  });
});
