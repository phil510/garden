import type { PointerEvent as ReactPointerEvent } from 'react';

interface ResizeHandleProps {
  /** Called on every pointermove while dragging, with the incremental delta since the
   *  previous event (not a cumulative delta from drag start) — callers add this straight
   *  onto their current width. */
  onResize: (deltaPx: number) => void;
  hidden?: boolean;
}

/** A thin drag affordance between two flex panels, styled and behaving like dockview's own
 *  pane sash (see stage.css) so the two read as the same interaction. Reports raw deltas only;
 *  bounds and clamping live in whatever store the caller's onResize writes to. */
export function ResizeHandle({ onResize, hidden }: ResizeHandleProps) {
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    // Pointer capture keeps move/up events routed to the handle, but text elsewhere on the
    // page is still selectable unless we say otherwise at the document level — the same
    // treatment dockview's own sash applies while its drag is live.
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.body.style.touchAction = 'none';
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onResize(event.movementX);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.touchAction = '';
  };

  return (
    <div
      className="resize-handle"
      hidden={hidden}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
