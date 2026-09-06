import { beforeEach, describe, expect, it } from 'vitest';
import { useLocalStore } from './localStore';

beforeEach(() => {
  useLocalStore.setState({ scrollOffsets: {}, expandedPaths: {}, openFileRequest: null });
});

describe('localStore', () => {
  it('starts with no scroll offsets or expanded paths', () => {
    expect(useLocalStore.getState().scrollOffsets).toEqual({});
    expect(useLocalStore.getState().expandedPaths).toEqual({});
  });

  it('records a scroll offset under its key', () => {
    useLocalStore.getState().setScrollOffset('sidebar', 120);
    expect(useLocalStore.getState().scrollOffsets).toEqual({ sidebar: 120 });
  });

  it('overwrites a scroll offset without disturbing other keys', () => {
    useLocalStore.getState().setScrollOffset('sidebar', 120);
    useLocalStore.getState().setScrollOffset('filetree', 40);
    useLocalStore.getState().setScrollOffset('sidebar', 200);
    expect(useLocalStore.getState().scrollOffsets).toEqual({ sidebar: 200, filetree: 40 });
  });

  it('expands a collapsed path', () => {
    useLocalStore.getState().toggleExpandedPath('sid-1', 'src');
    expect(useLocalStore.getState().expandedPaths).toEqual({ 'sid-1': ['src'] });
  });

  it('collapses an expanded path', () => {
    useLocalStore.getState().toggleExpandedPath('sid-1', 'src');
    useLocalStore.getState().toggleExpandedPath('sid-1', 'src');
    expect(useLocalStore.getState().expandedPaths).toEqual({ 'sid-1': [] });
  });

  it('keeps expanded paths scoped to their own session', () => {
    useLocalStore.getState().toggleExpandedPath('sid-1', 'src');
    useLocalStore.getState().toggleExpandedPath('sid-2', 'lib');
    expect(useLocalStore.getState().expandedPaths).toEqual({
      'sid-1': ['src'],
      'sid-2': ['lib'],
    });
  });

  it('records a requested file open', () => {
    useLocalStore.getState().requestOpenFile('sid-1', 'src/foo.ts', 42);
    expect(useLocalStore.getState().openFileRequest).toEqual({
      sessionId: 'sid-1',
      path: 'src/foo.ts',
      line: 42,
    });
  });

  it('overwrites a pending open request with the latest one', () => {
    useLocalStore.getState().requestOpenFile('sid-1', 'src/foo.ts', 42);
    useLocalStore.getState().requestOpenFile('sid-2', 'src/bar.ts', 7);
    expect(useLocalStore.getState().openFileRequest).toEqual({
      sessionId: 'sid-2',
      path: 'src/bar.ts',
      line: 7,
    });
  });
});
