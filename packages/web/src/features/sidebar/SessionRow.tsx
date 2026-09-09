import type { SessionState } from '@garden/shared';
import { useEffect, useState, type MouseEvent } from 'react';
import { killSession, resumeSession } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { StatusPill } from '../../components/StatusPill';
import { HoverCard } from './HoverCard';
import { lastPathSegment } from './lastPathSegment';
import { formatRelativeTime } from './relativeTime';

const COPIED_RESET_MS = 1400;

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
  const [copied, setCopied] = useState(false);
  const dead = session.liveness === 'dead';
  const title = session.title ?? lastPathSegment(session.cwd);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

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

  function handleCopyAttach(event: MouseEvent) {
    event.stopPropagation();
    if (session.tmuxName === null) return;
    navigator.clipboard
      .writeText(`tmux -L garden attach -t ${session.tmuxName}`)
      .then(() => setCopied(true))
      .catch(reportCommandFailure);
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
      {focused && <span className="on-stage-mark" title="Focused" />}
      <div className="row-top">
        <span className="row-title">{title}</span>
        {session.liveness === 'live' && session.status !== null && (
          <StatusPill status={session.status} />
        )}
      </div>
      <div className="row-meta">
        {session.branch !== null && <span className="row-branch mono">{session.branch}</span>}
        {session.branch !== null && <span className="row-dot-sep faint">·</span>}
        <span className="row-time">{formatRelativeTime(session.lastActivity, now)}</span>
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
          {session.tmuxName !== null && (
            <button onClick={handleCopyAttach}>{copied ? 'Copied' : 'Copy attach'}</button>
          )}
        </div>
      )}
      {hovered && rowEl !== null && (
        <HoverCard title={title} session={session} anchor={rowEl} now={now} />
      )}
    </div>
  );
}
