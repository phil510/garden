import type { SessionState } from '@garden/shared';
import { Fragment, useState, type MouseEvent } from 'react';
import { killSession, resumeSession } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { StatusPill } from '../../components/StatusPill';
import { HoverCard } from './HoverCard';
import { lastPathSegment } from './lastPathSegment';
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
  const [confirmingKill, setConfirmingKill] = useState(false);
  const dead = session.liveness === 'dead';
  const title = session.title ?? lastPathSegment(session.cwd);

  function handleKill(event: MouseEvent) {
    event.stopPropagation();
    setConfirmingKill(true);
  }

  function handleKillCancel(event: MouseEvent) {
    event.stopPropagation();
    setConfirmingKill(false);
  }

  function handleKillConfirm(event: MouseEvent) {
    event.stopPropagation();
    setConfirmingKill(false);
    killSession(session.id).catch(reportCommandFailure);
  }

  function handleResume(event: MouseEvent) {
    event.stopPropagation();
    resumeSession(session.id).catch(reportCommandFailure);
  }

  return (
    <div
      ref={setRowEl}
      className={`session-row${onStage ? ' on-stage' : ''}${dead ? ' dead' : ''}`}
      tabIndex={0}
      onClick={() => onSelect(session.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {focused && <span className="focused-mark" title="Focused" />}
      <div className="row-title">{title}</div>
      <div className="row-meta">
        {session.liveness === 'live' && session.status !== null && (
          <StatusPill status={session.status} />
        )}
        {metaLineSegments(session, now).map((segment, index) => (
          <Fragment key={segment.key}>
            {index > 0 && <span className="row-dot-sep faint">·</span>}
            <span className={metaLineSegmentClassName(segment)}>{segment.text}</span>
          </Fragment>
        ))}
      </div>
      {confirmingKill ? (
        <div className="row-confirm">
          <span className="muted">Kill session?</span>
          <button className="danger" onClick={handleKillConfirm}>
            Confirm
          </button>
          <button className="ghost" onClick={handleKillCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="row-actions">
          {dead && <button onClick={handleResume}>Resume</button>}
          {!dead && (
            <button className="danger" onClick={handleKill}>
              Kill
            </button>
          )}
        </div>
      )}
      {hovered && rowEl !== null && (
        <HoverCard title={title} session={session} anchor={rowEl} now={now} />
      )}
    </div>
  );
}
