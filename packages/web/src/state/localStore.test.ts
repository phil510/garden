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

  it('records a requested file open with no line target', () => {
    useLocalStore.getState().requestOpenFile('sid-1', 'src/foo.ts', null);
    expect(useLocalStore.getState().openFileRequest).toEqual({
      sessionId: 'sid-1',
      path: 'src/foo.ts',
      line: null,
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

  // Every resizeSidebarBy/resizeFilePanelBy call below passes a generous viewportWidth (1024)
  // and otherPanelReserved (0) so the per-field min/max is the only bound in play, unless a
  // test is specifically exercising the viewport-aware stage floor.
  it('accumulates consecutive sidebar resize deltas against the latest store value', () => {
    // Each call reads the store's current value rather than one a caller captured earlier —
    // the behavior a drag depends on, since a fast pointermove stream can fire several of
    // these before a caller holding a stale width would have re-rendered.
    useLocalStore.getState().resizeSidebarBy(20, 1024, 0);
    useLocalStore.getState().resizeSidebarBy(20, 1024, 0);
    expect(useLocalStore.getState().sidebarWidth).toBe(320);
  });

  it('clamps an accumulated sidebar resize at its minimum', () => {
    useLocalStore.getState().resizeSidebarBy(-1000, 1024, 0);
    expect(useLocalStore.getState().sidebarWidth).toBe(180);
  });

  it('clamps an accumulated sidebar resize at its maximum', () => {
    useLocalStore.getState().resizeSidebarBy(1000, 1024, 0);
    expect(useLocalStore.getState().sidebarWidth).toBe(560);
  });

  it('accumulates consecutive file panel resize deltas against the latest store value', () => {
    useLocalStore.getState().resizeFilePanelBy(-20, 1024, 0);
    useLocalStore.getState().resizeFilePanelBy(-20, 1024, 0);
    expect(useLocalStore.getState().filePanelWidth).toBe(280);
  });

  it('clamps an accumulated file panel resize at its minimum', () => {
    useLocalStore.getState().resizeFilePanelBy(-1000, 1024, 0);
    expect(useLocalStore.getState().filePanelWidth).toBe(220);
  });

  it('clamps an accumulated file panel resize at its maximum, unchanged on a narrow viewport', () => {
    useLocalStore.getState().resizeFilePanelBy(1000, 1024, 0);
    expect(useLocalStore.getState().filePanelWidth).toBe(640);
  });

  it('lets the file panel resize reach half the viewport width on a wide display', () => {
    useLocalStore.getState().resizeFilePanelBy(5000, 2000, 0);
    expect(useLocalStore.getState().filePanelWidth).toBe(1000);
  });

  it('caps the sidebar resize below its own maximum when the file panel and stage floor would not otherwise fit', () => {
    // Viewport 1000px, file panel reserving 500px, stage floor 200px -> room for the
    // sidebar tops out at 300px even though its own max is 560.
    useLocalStore.getState().resizeSidebarBy(1000, 1000, 500);
    expect(useLocalStore.getState().sidebarWidth).toBe(300);
  });

  it('ignores the file panel reservation while it is closed, so the sidebar can still reach its own maximum', () => {
    useLocalStore.getState().resizeSidebarBy(1000, 1000, 0);
    expect(useLocalStore.getState().sidebarWidth).toBe(560);
  });

  it('caps the file panel resize below its own maximum when the sidebar and stage floor would not otherwise fit', () => {
    useLocalStore.getState().resizeFilePanelBy(1000, 1000, 500);
    expect(useLocalStore.getState().filePanelWidth).toBe(300);
  });

  it('keeps the stage floor winning over the proportional maximum on a wide display', () => {
    // Viewport 3000px gives a proportional max of 1500px, but the sidebar reserves 2500px,
    // leaving only 300px of room once the stage floor is held back -> that room, not the
    // proportional max, is what caps the file panel.
    useLocalStore.getState().resizeFilePanelBy(5000, 3000, 2500);
    expect(useLocalStore.getState().filePanelWidth).toBe(300);
  });
});
