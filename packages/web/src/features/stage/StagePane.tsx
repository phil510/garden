import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef, type MouseEvent } from 'react';
import { resumeSession, updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { StatusPill } from '../../components/StatusPill';
import { useLocalStore } from '../../state/localStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { attachPane, detachPane } from '../../terminals/registry';
import { lastPathSegment } from '../sidebar/lastPathSegment';
import { deadPaneStatusLine } from './deadPaneStatus';
import { paneWorktreeLabel } from './paneWorktreeLabel';
import { removeFromStage } from './removeFromStage';

const DEAD_ICON = (
  <svg
    width="26"
    height="26"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </svg>
);

/** The panel id is the session id, so the pane needs nothing from its dockview params. */
export function StagePane(props: IDockviewPanelProps) {
  const session = useSessionStore((state) => state.sessions[props.api.id]);
  const uiState = useUiStore((state) => state.uiState);
  const slot = uiState.slots.indexOf(props.api.id);
  const focused = slot !== -1 && slot === uiState.focusedSlot;
  const live = session?.liveness === 'live';
  const connectionEpoch = useLocalStore((state) => state.connectionEpoch);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Mounts the session's terminal into this pane's container while it is live. Disposal is
  // deliberately not this cleanup: dockview reuses a panel across a layout change, remounting
  // React around a terminal that kept its socket, so the layout and liveness own a pane's
  // lifetime — Stage's `onDidRemovePanel` and the effect below.
  useEffect(() => {
    if (!live) return;
    const container = terminalRef.current;
    if (container === null) return;
    attachPane(props.api.id, container, connectionEpoch);
  }, [props.api.id, live, connectionEpoch]);

  // Nothing renders a dead session's bytes, so its pane goes rather than staying warm behind
  // the placeholder. Fires on the render that stopped being live, not on unmount.
  useEffect(() => {
    if (live) return;
    detachPane(props.api.id);
  }, [props.api.id, live]);

  function focus() {
    if (slot === -1 || focused) return;
    updateUiState({ focusedSlot: slot }).catch(reportCommandFailure);
  }

  // Maximising hides the siblings rather than unmounting them, so their xterm instances and
  // sockets carry on running behind the maximised pane.
  function toggleMaximise(event: MouseEvent) {
    event.stopPropagation();
    if (props.api.isMaximized()) props.api.exitMaximized();
    else props.api.maximize();
  }

  function close(event: MouseEvent) {
    event.stopPropagation();
    updateUiState(removeFromStage(uiState.slots, uiState.focusedSlot, props.api.id)).catch(
      reportCommandFailure,
    );
  }

  function resume(event: MouseEvent) {
    event.stopPropagation();
    resumeSession(props.api.id).catch(reportCommandFailure);
  }

  if (session === undefined) return null;

  const worktree = paneWorktreeLabel(session);

  return (
    <div
      className={focused ? 'pane focused' : 'pane'}
      onClick={focus}
      onDoubleClick={toggleMaximise}
    >
      <div className="pane-header">
        <div className="pane-title-wrap">
          <div className="pane-title">{session.title ?? session.cwd}</div>
          {session.branch !== null && (
            <div className="pane-meta-row">
              <span className="pane-meta-k">branch:</span>
              <span className="pane-meta-v">{session.branch}</span>
            </div>
          )}
          {session.repoRoot !== null && (
            <div className="pane-meta-row">
              <span className="pane-meta-k">project:</span>
              <span className="pane-meta-v">{lastPathSegment(session.repoRoot)}</span>
            </div>
          )}
          {worktree !== null && (
            <div className="pane-meta-row">
              <span className="pane-meta-k">worktree:</span>
              <span className="pane-meta-v">{worktree}</span>
            </div>
          )}
        </div>
        {live && session.status !== null && <StatusPill status={session.status} />}
        <div className="pane-header-actions">
          <button className="ghost icon-btn" title="Maximise" onClick={toggleMaximise}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
          <button className="ghost icon-btn" title="Return to sidebar" onClick={close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
      {live ? (
        <div className="pane-term" ref={terminalRef} />
      ) : (
        <div className="dead-pane-body">
          <div className="dp-icon">{DEAD_ICON}</div>
          <div className="dp-line1">{deadPaneStatusLine(session.exitCode)}</div>
          <div className="dp-line2">{session.recap ?? 'No recap available.'}</div>
          <button className="primary" onClick={resume}>
            Resume
          </button>
        </div>
      )}
    </div>
  );
}

export function EmptySlotPane() {
  return <div className="pane empty">Empty slot — click a session to fill it</div>;
}
