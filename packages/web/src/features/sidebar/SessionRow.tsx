import type { SessionState } from '@garden/shared';
import { Fragment, useEffect, useRef, useState, type MouseEvent } from 'react';
import { killSession, resumeSession } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { ContextMenu } from '../../components/ContextMenu';
import { StatusPill } from '../../components/StatusPill';
import { HoverCard } from './HoverCard';
import { lastPathSegment } from './lastPathSegment';
import {
  sessionRowMenuAction,
  sessionRowMenuItems,
  type ConfirmingAction,
} from './sessionRowMenuItems';
import { metaLineSegmentClassName, metaLineSegments } from './sessionIdentity';

interface SessionRowProps {
  session: SessionState;
  onStage: boolean;
  focused: boolean;
  now: number;
  onSelect: (id: string) => void;
}

export function SessionRow({ session, onStage, focused, now, onSelect }: SessionRowProps) {
  // A callback ref feeding state, not a plain ref, so the hover card's anchor is safe to
  // read during render — a raw ref's `.current` is not.
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [contextMenuPoint, setContextMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState<ConfirmingAction>(null);
  const dead = session.liveness === 'dead';
  const title = session.title ?? lastPathSegment(session.cwd);

  // ContextMenu's own container-level guard stops a click from bubbling into onClick below
  // when the press and release both land inside the menu. It can't catch a press that starts
  // on a menu item and releases on the row body: the browser targets that mismatched
  // mousedown/mouseup pair at their common ancestor (the row itself), so the click never
  // passes through the menu's subtree at all. Tracked here instead, at the one point both
  // ends of that drag share — on the capture phase, so this still sees the press before the
  // menu's own bubble-phase guard (which runs later) can stop it from getting this far.
  // Reset whenever the menu's own lifecycle changes so a press from a previous menu never
  // survives to arbitrate a later click.
  const pressStartedInMenuRef = useRef(false);
  useEffect(() => {
    pressStartedInMenuRef.current = false;
  }, [contextMenuPoint]);

  function handleRowMouseDown(event: MouseEvent) {
    pressStartedInMenuRef.current =
      contextMenuPoint !== null &&
      event.target instanceof Element &&
      event.target.closest('.context-menu') !== null;
  }

  function handleRowClick() {
    const pressStartedInMenu = pressStartedInMenuRef.current;
    pressStartedInMenuRef.current = false;
    if (pressStartedInMenu) return;
    onSelect(session.id);
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setConfirming(null);
    setContextMenuPoint({ x: event.clientX, y: event.clientY });
  }

  function closeContextMenu() {
    setContextMenuPoint(null);
    setConfirming(null);
  }

  const menuItems = sessionRowMenuItems(dead, confirming).map((item) => ({
    ...item,
    onSelect: () => {
      const result = sessionRowMenuAction(item.key);
      setConfirming(result.confirming);
      if (result.act === 'kill') killSession(session.id).catch(reportCommandFailure);
      if (result.act === 'resume') resumeSession(session.id).catch(reportCommandFailure);
      if (result.act !== null) setContextMenuPoint(null);
    },
  }));

  return (
    <div
      ref={setRowEl}
      className={`session-row${onStage ? ' on-stage' : ''}${dead ? ' dead' : ''}`}
      tabIndex={0}
      onClick={handleRowClick}
      onMouseDownCapture={handleRowMouseDown}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {focused && <span className="focused-mark" title="Focused" />}
      <div className="row-title-line">
        <div className="row-title">{title}</div>
        {session.liveness === 'live' && session.status !== null && (
          <StatusPill status={session.status} />
        )}
      </div>
      <div className="row-meta">
        {metaLineSegments(session, now).map((segment, index) => (
          <Fragment key={segment.key}>
            {index > 0 && <span className="row-dot-sep faint">·</span>}
            <span className={metaLineSegmentClassName(segment)}>{segment.text}</span>
          </Fragment>
        ))}
      </div>
      {hovered && rowEl !== null && contextMenuPoint === null && (
        <HoverCard title={title} session={session} anchor={rowEl} now={now} />
      )}
      {contextMenuPoint !== null && (
        <ContextMenu
          x={contextMenuPoint.x}
          y={contextMenuPoint.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
