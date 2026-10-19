import type { KeyboardEvent, MouseEvent } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { SessionState } from '@garden/shared';
import { dismissAlert, updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { displayStatus } from '../../components/displayStatus';
import { StatusPill } from '../../components/StatusPill';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { lastPathSegment } from '../sidebar/lastPathSegment';
import { placeOnStage } from '../sidebar/placeOnStage';
import { focusedSessionId } from '../sidebar/stageFocus';
import { swarmChipFor } from '../stage/paneTitle';
import { alertAgesLine, collectAlerts } from './allAlerts';
import './alerts.css';

interface AlertEntryProps {
  session: SessionState;
  context: string;
  selected: boolean;
  now: number;
  onSelect: () => void;
}

function AlertEntry({ session, context, selected, now, onSelect }: AlertEntryProps) {
  const alert = session.alert;
  const textRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measured while clamped, so the link appears only when the text is cut off. The panel stays
  // mounted under `display: none`, where both sizes read 0, so re-measure whenever the box resizes.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el === null || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [alert?.text, expanded]);

  if (alert === null) return null;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.target === event.currentTarget) onSelect();
  }

  function onDismiss(event: MouseEvent) {
    event.stopPropagation();
    dismissAlert(session.id).catch(reportCommandFailure);
  }

  function onToggle(event: MouseEvent) {
    event.stopPropagation();
    setExpanded(!expanded);
  }

  return (
    <div
      className={`al-item${selected ? ' selected' : ''}`}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <div className="al-top">
        <span className="t">{session.title ?? lastPathSegment(session.cwd)}</span>
        {session.liveness === 'dead' ? (
          <span className="deadtag">dead</span>
        ) : (
          session.status !== null && (
            <StatusPill status={displayStatus(session.status, session.alert)} />
          )
        )}
      </div>
      {context !== '' && <div className="al-ctx">{context}</div>}
      <div ref={textRef} className={`alert-text${expanded ? ' open' : ''}`}>
        {alert.text}
      </div>
      {(overflows || expanded) && (
        <button className="link-btn" onClick={onToggle}>
          {expanded ? 'Show less' : 'Show full text'}
        </button>
      )}
      <div className="al-foot">
        <span className="when">{alertAgesLine(alert, now)}</span>
        <button className="small" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** Every open alert in one list, oldest first, in the file panel's slot. */
export function AlertsPanel() {
  const sessions = useSessionStore((state) => state.sessions);
  const uiState = useUiStore((state) => state.uiState);

  const alerts = collectAlerts(Object.values(sessions));
  const focusedId = focusedSessionId(uiState.slots, uiState.focusedSlot);
  const now = Date.now();

  function focusSession(id: string) {
    updateUiState(placeOnStage(uiState.slots, uiState.focusedSlot, id)).catch(reportCommandFailure);
  }

  function contextLine(session: SessionState): string {
    const swarm = swarmChipFor(session, uiState.placements, uiState.swarms);
    const repo = lastPathSegment(session.repoRoot ?? session.cwd);
    return swarm === null ? repo : `${swarm.name} / ${repo}`;
  }

  return (
    <div className="awp">
      <div className="awp-head">
        <h2>Alerts</h2>
        {alerts.length > 0 && (
          <div className="aw-sum">
            <span>
              {alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'} · oldest first
            </span>
          </div>
        )}
      </div>
      {alerts.length === 0 ? (
        <div className="aw-empty">
          <div>No open alerts.</div>
          <div className="faint">
            When an agent runs <span className="mono">garden alert "…"</span>, it shows up here
            until it clears it or you dismiss it.
          </div>
        </div>
      ) : (
        <div className="aw-list">
          {alerts.map((session) => (
            <AlertEntry
              key={session.id}
              session={session}
              context={contextLine(session)}
              selected={session.id === focusedId}
              now={now}
              onSelect={() => focusSession(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
