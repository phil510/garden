import { describe, expect, it } from 'vitest';
import type { FileResponse } from '@garden/shared';
import {
  activeSource,
  liveTransient,
  nextLoaded,
  sameFileContent,
  sourceKey,
  isLoading,
  type LoadedFile,
} from './viewerSource';

describe('liveTransient', () => {
  const transient = { sessionId: 's1', path: 'y.ts', root: '/a', openFile: 'x.ts' };

  it('keeps a transient file while root and open file match', () => {
    expect(liveTransient('/a', 'x.ts', transient)).toBe(transient);
  });

  it('drops it when the open file or root differ, so returning to them does not revive it', () => {
    expect(liveTransient('/a', 'z.ts', transient)).toBeNull();
    expect(liveTransient('/b', 'x.ts', transient)).toBeNull();
    expect(liveTransient('/a', 'x.ts', liveTransient('/a', 'z.ts', transient))).toBeNull();
  });

  it('passes null through', () => {
    expect(liveTransient('/a', 'x.ts', null)).toBeNull();
  });
});

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

describe('nextLoaded', () => {
  const text: FileResponse = { kind: 'text', path: 'a.ts', text: 'x', truncated: false };
  const loadedFile: LoadedFile = { key: 'k', result: { kind: 'file', file: text } };
  const failure = { kind: 'error', message: 'no such path' } as const;

  it('keeps the current reference when a refetch brought the same content', () => {
    expect(nextLoaded(loadedFile, 'k', { kind: 'file', file: { ...text } })).toBe(loadedFile);
  });

  it('replaces a file with an error for the same key', () => {
    expect(nextLoaded(loadedFile, 'k', failure)).toEqual({ key: 'k', result: failure });
  });

  it('replaces an error with a file for the same key', () => {
    const errored: LoadedFile = { key: 'k', result: failure };
    expect(nextLoaded(errored, 'k', { kind: 'file', file: text })).toEqual(loadedFile);
  });

  it('replaces the current value when the key differs, even with identical content', () => {
    expect(nextLoaded(loadedFile, 'other', { kind: 'file', file: text })).toEqual({
      key: 'other',
      result: { kind: 'file', file: text },
    });
  });
});

describe('isLoading', () => {
  const source = { kind: 'root', root: '/a', path: 'x.ts' } as const;
  const file: FileResponse = { kind: 'binary', path: 'x.ts' };

  it('is true while a selected file has no result yet, so the viewer is not empty', () => {
    expect(isLoading(source, null)).toBe(true);
  });

  it('is false with nothing selected', () => {
    expect(isLoading(null, null)).toBe(false);
  });

  it('is false once the fetch has resolved, either way', () => {
    expect(isLoading(source, { kind: 'file', file })).toBe(false);
    expect(isLoading(source, { kind: 'error', message: 'nope' })).toBe(false);
  });
});
