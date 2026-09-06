import type { SessionState, Status } from '@garden/shared';
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

interface SessionRowProps {
  session: SessionState;
  onStage: boolean;
  now: number;
}

export function SessionRow({ session, onStage, now }: SessionRowProps) {
  const dead = session.liveness === 'dead';
  const title = session.title ?? repoRelativeTitle(session.cwd);

  return (
    <div className={`session-row${onStage ? ' on-stage' : ''}${dead ? ' dead' : ''}`} tabIndex={0}>
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
    </div>
  );
}

function repoRelativeTitle(cwd: string): string {
  const segments = cwd.split('/').filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? cwd;
}
