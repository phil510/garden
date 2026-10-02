import { describe, expect, it } from 'vitest';
import { activeSource, sameFileContent, sourceKey } from './viewerSource';

describe('activeSource', () => {
  it('shows the root open file when there is no transient file', () => {
    expect(activeSource('/a', 'x.ts', null)).toEqual({ kind: 'root', root: '/a', path: 'x.ts' });
  });

  it('shows nothing without a root or without an open file', () => {
    expect(activeSource(null, 'x.ts', null)).toBeNull();
    expect(activeSource('/a', null, null)).toBeNull();
  });

  it('prefers a transient file opened against the current root and open file', () => {
    const transient = { sessionId: 's1', path: 'y.ts', root: '/a', openFile: 'x.ts' };
    expect(activeSource('/a', 'x.ts', transient)).toEqual({
      kind: 'session',
      sessionId: 's1',
      path: 'y.ts',
    });
  });

  it('drops a transient file once the open file changes', () => {
    const transient = { sessionId: 's1', path: 'y.ts', root: '/a', openFile: 'x.ts' };
    expect(activeSource('/a', 'z.ts', transient)).toEqual({
      kind: 'root',
      root: '/a',
      path: 'z.ts',
    });
  });

  it('drops a transient file once the root changes', () => {
    const transient = { sessionId: 's1', path: 'y.ts', root: '/a', openFile: null };
    expect(activeSource('/b', null, transient)).toBeNull();
  });

  it('shows a transient file when the panel has no root', () => {
    const transient = { sessionId: 's1', path: 'y.ts', root: null, openFile: null };
    expect(activeSource(null, null, transient)?.kind).toBe('session');
  });
});

describe('sourceKey', () => {
  it('tells the same path apart across roots and sessions', () => {
    const keys = [
      sourceKey({ kind: 'root', root: '/a', path: 'x' }),
      sourceKey({ kind: 'root', root: '/b', path: 'x' }),
      sourceKey({ kind: 'session', sessionId: 's1', path: 'x' }),
    ];
    expect(new Set(keys).size).toBe(3);
  });
});

describe('sameFileContent', () => {
  it('is true for identical text', () => {
    const file = { path: 'a', kind: 'text', text: 'hi', truncated: false } as const;
    expect(sameFileContent(file, { ...file })).toBe(true);
  });

  it('is false when the text changed', () => {
    const file = { path: 'a', kind: 'text', text: 'hi', truncated: false } as const;
    expect(sameFileContent(file, { ...file, text: 'ho' })).toBe(false);
  });

  it('is false across kinds', () => {
    expect(
      sameFileContent(
        { path: 'a', kind: 'text', text: '', truncated: false },
        { path: 'a', kind: 'binary' },
      ),
    ).toBe(false);
  });

  it('compares image data', () => {
    const image = {
      path: 'a',
      kind: 'image',
      mimeType: 'image/png',
      truncated: false,
      data: 'AAA',
    } as const;
    expect(sameFileContent(image, { ...image })).toBe(true);
    expect(sameFileContent(image, { ...image, data: 'BBB' })).toBe(false);
  });
});
