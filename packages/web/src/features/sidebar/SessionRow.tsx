import type { SessionState, Status } from '@garden/shared';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { killSession, resumeSession } from '../../api/client';
import { HoverCard } from './HoverCard';
import { formatRelativeTime } from './relativeTime';

const STATUS_LABEL: Record<Status, string> = {
  working: 'working',
  'needs-approval': 'needs approval',
  waiting: 'waiting',
  unknown: 'unknown',
};

const STATUS_COLOR_VAR: Record<Status, string> = {
  working: 'var(--st-working)',
  'needs-approval': 'var(--st-needs-approval)',
  waiting: 'var(--st-waiting)',
  unknown: 'var(--st-unknown)',
};

const COPIED_RESET_MS = 1400;

interface SessionRowProps {
  session: SessionState;
  onStage: boolean;
  now: number;
  onSelect: (id: string) => void;
}

export function SessionRow({ session, onStage, now, onSelect }: SessionRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [confirmingKill, setConfirmingKill] = useState(false);
  const [copied, setCopied] = useState(false);
  const dead = session.liveness === 'dead';
  const title = session.title ?? repoRelativeTitle(session.cwd);

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
    void killSession(session.id);
  }

  function handleResume(event: MouseEvent) {
    event.stopPropagation();
    void resumeSession(session.id);
  }

  function handleCopyAttach(event: MouseEvent) {
    event.stopPropagation();
    if (session.tmuxName === null) return;
    void navigator.clipboard.writeText(`tmux -L garden attach -t ${session.tmuxName}`);
    setCopied(true);
  }

  return (
    <div
      ref={rowRef}
      className={`session-row${onStage ? ' on-stage' : ''}${dead ? ' dead' : ''}`}
      tabIndex={0}
      onClick={() => onSelect(session.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {onStage && <span className="on-stage-mark" title="On stage" />}
      <div className="row-top">
        <span className="row-title">{title}</span>
        {session.liveness === 'live' && session.status !== null && (
          <span className="status-pill" style={{ color: STATUS_COLOR_VAR[session.status] }}>
            <span className="dot" style={{ background: STATUS_COLOR_VAR[session.status] }} />
            {STATUS_LABEL[session.status]}
          </span>
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
      {hovered && rowRef.current !== null && (
        <HoverCard title={title} session={session} anchor={rowRef.current} now={now} />
      )}
    </div>
  );
}

function repoRelativeTitle(cwd: string): string {
  const segments = cwd.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? cwd;
}
