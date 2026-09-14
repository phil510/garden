import { describe, expect, it } from 'vitest';
import { isMarkdownFile } from './markdown';

describe('isMarkdownFile', () => {
  it('treats a .md path as markdown', () => {
    expect(isMarkdownFile('docs/README.md')).toBe(true);
  });

  it('treats a .markdown path as markdown', () => {
    expect(isMarkdownFile('notes/todo.markdown')).toBe(true);
  });

  it('does not treat a non-markdown path as markdown', () => {
    expect(isMarkdownFile('src/App.tsx')).toBe(false);
  });
});
