import { beforeEach, describe, expect, it } from 'vitest';
import { useLocalStore } from './localStore';

beforeEach(() => {
  useLocalStore.setState({
    scrollOffsets: {},
    expandedPaths: {},
    openFileRequest: null,
    sidebarWidth: 280,
    filePanelWidth: 320,
  });
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

  it('gives every connection its own epoch, so a pane can tell a reconnect from a redraw', () => {
    const start = useLocalStore.getState().connectionEpoch;
    useLocalStore.getState().noteConnected();
    useLocalStore.getState().noteConnected();
    expect(useLocalStore.getState().connectionEpoch).toBe(start + 2);
  });

  it('starts with the sidebars at their default widths', () => {
    expect(useLocalStore.getState().sidebarWidth).toBe(280);
    expect(useLocalStore.getState().filePanelWidth).toBe(320);
  });

  it('sets the sidebar width', () => {
    useLocalStore.getState().setSidebarWidth(400);
    expect(useLocalStore.getState().sidebarWidth).toBe(400);
  });

  it('clamps the sidebar width below its minimum', () => {
    useLocalStore.getState().setSidebarWidth(50);
    expect(useLocalStore.getState().sidebarWidth).toBe(180);
  });

  it('clamps the sidebar width above its maximum', () => {
    useLocalStore.getState().setSidebarWidth(900);
    expect(useLocalStore.getState().sidebarWidth).toBe(560);
  });

  it('sets the file panel width', () => {
    useLocalStore.getState().setFilePanelWidth(450);
    expect(useLocalStore.getState().filePanelWidth).toBe(450);
  });

  it('clamps the file panel width below its minimum', () => {
    useLocalStore.getState().setFilePanelWidth(50);
    expect(useLocalStore.getState().filePanelWidth).toBe(220);
  });

  it('clamps the file panel width above its maximum', () => {
    useLocalStore.getState().setFilePanelWidth(900);
    expect(useLocalStore.getState().filePanelWidth).toBe(640);
  });

  it('setting one sidebar width does not disturb the other', () => {
    useLocalStore.getState().setSidebarWidth(400);
    useLocalStore.getState().setFilePanelWidth(500);
    expect(useLocalStore.getState().sidebarWidth).toBe(400);
    expect(useLocalStore.getState().filePanelWidth).toBe(500);
  });

  it('accumulates consecutive sidebar resize deltas against the latest store value', () => {
    // Each call reads the store's current value rather than one a caller captured earlier —
    // the behavior a drag depends on, since a fast pointermove stream can fire several of
    // these before a caller holding a stale width would have re-rendered.
    useLocalStore.getState().resizeSidebarBy(20);
    useLocalStore.getState().resizeSidebarBy(20);
    expect(useLocalStore.getState().sidebarWidth).toBe(320);
  });

  it('clamps an accumulated sidebar resize at its minimum', () => {
    useLocalStore.getState().resizeSidebarBy(-1000);
    expect(useLocalStore.getState().sidebarWidth).toBe(180);
  });

  it('clamps an accumulated sidebar resize at its maximum', () => {
    useLocalStore.getState().resizeSidebarBy(1000);
    expect(useLocalStore.getState().sidebarWidth).toBe(560);
  });

  it('accumulates consecutive file panel resize deltas against the latest store value', () => {
    useLocalStore.getState().resizeFilePanelBy(-20);
    useLocalStore.getState().resizeFilePanelBy(-20);
    expect(useLocalStore.getState().filePanelWidth).toBe(280);
  });

  it('clamps an accumulated file panel resize at its minimum', () => {
    useLocalStore.getState().resizeFilePanelBy(-1000);
    expect(useLocalStore.getState().filePanelWidth).toBe(220);
  });

  it('clamps an accumulated file panel resize at its maximum', () => {
    useLocalStore.getState().resizeFilePanelBy(1000);
    expect(useLocalStore.getState().filePanelWidth).toBe(640);
  });
});
