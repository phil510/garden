import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { IDockviewPanelProps } from 'dockview-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { killSession, resumeSession, updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { StatusPill } from '../../components/StatusPill';
import { useLocalStore } from '../../state/localStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { attachPane, detachPane } from '../../terminals/registry';
import { togglePaneMaximised } from './applyLayout';
import { deadPaneStatusLine } from './deadPaneStatus';
import { paneTitle, swarmChipFor } from './paneTitle';
import { removeFromStage } from './removeFromStage';
import { slotFromEmptySlotId } from './presetLayout';

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

interface MetaRowProps {
  label: string;
  value: string | null;
}

function MetaRow({ label, value }: MetaRowProps) {
  // A session momentarily has an empty cwd between creation and its first transcript read
  // (reduce.ts's `blank()`); an empty value reads as absent, the same as null.
  if (value === null || value === '') return null;
  return (
    <div className="pane-meta-row">
      <span className="pane-meta-k">{label}:</span>
      <span className="pane-meta-v">{value}</span>
    </div>
  );
}

/** The panel id is the session id, so the pane needs nothing from its dockview params. */
export function StagePane(props: IDockviewPanelProps) {
  const session = useSessionStore((state) => state.sessions[props.api.id]);
  const uiState = useUiStore((state) => state.uiState);
  const slot = uiState.slots.indexOf(props.api.id);
  const focused = slot !== -1 && slot === uiState.focusedSlot;
  const live = session?.liveness === 'live';
  const connectionEpoch = useLocalStore((state) => state.connectionEpoch);
  const setSidebarMode = useLocalStore((state) => state.setSidebarMode);
  const setSelectedSwarmId = useLocalStore((state) => state.setSelectedSwarmId);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [confirmingKill, setConfirmingKill] = useState(false);

  const {
    setNodeRef: setDraggableRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: props.api.id,
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: String(slot) });

  // Stable across renders: an inline closure here would make dnd-kit's own setNodeRef see a
  // "new" ref every render, tearing down and re-registering its resize observer even when
  // nothing about this pane's DOM node changed.
  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef],
  );

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

  // The panel is keyed by session id, so the same component instance survives a kill/resume
  // round trip. Without this, an armed-but-unconfirmed kill would still be armed after the
  // session came back live, defeating the confirmation step for the next click.
  useEffect(() => {
    if (live) return;
    setConfirmingKill(false);
  }, [live]);

  // Every hook above must run unconditionally, so the "no session" bail-out sits here rather
  // than at the top — everything below can then treat `session` as defined.
  if (session === undefined) return null;

  const swarmChip = swarmChipFor(session, uiState.placements, uiState.swarms);

  function goToSwarm(event: MouseEvent) {
    event.stopPropagation();
    if (swarmChip === null) return;
    setSidebarMode('swarms');
    setSelectedSwarmId(swarmChip.id);
  }

  function focus() {
    if (slot === -1 || focused) return;
    updateUiState({ focusedSlot: slot }).catch(reportCommandFailure);
  }

  // Maximising hides the siblings rather than unmounting them, so their xterm instances and
  // sockets carry on running behind the maximised pane.
  function toggleMaximise(event: MouseEvent) {
    event.stopPropagation();
    togglePaneMaximised(props.api, focus);
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
    // Cleared on success, not optimistically: a failed kill then leaves the confirm/cancel
    // pair on screen instead of disappearing as though it worked while the session stays live.
    killSession(props.api.id)
      .then(() => setConfirmingKill(false))
      .catch(reportCommandFailure);
  }

  const classes = ['pane'];
  if (focused) classes.push('focused');
  if (isDragging) classes.push('dragging');
  if (isOver) classes.push('drop-target');

  return (
    <div
      ref={setNodeRef}
      className={classes.join(' ')}
      onClick={focus}
      onDoubleClick={toggleMaximise}
    >
      <div className="pane-header">
        <div className="pane-title-wrap">
          <div className="pane-title">
            {swarmChip !== null && (
              <>
                <span className="pane-swarm-chip" onClick={goToSwarm}>
                  {swarmChip.name}
                </span>
                <span className="pane-swarm-sep">›</span>
              </>
            )}
            <span className="pane-title-text">{paneTitle(session)}</span>
          </div>
          <MetaRow label="branch" value={session.branch} />
          <MetaRow
            label="session"
            value={
              session.claudeSessionName === null || session.claudeSessionName === ''
                ? 'No name yet.'
                : session.claudeSessionName
            }
          />
        </div>
        {live && session.status !== null && <StatusPill status={session.status} />}
        <div className="pane-header-actions">
          {live &&
            (confirmingKill ? (
              <>
                <button
                  className="ghost icon-btn danger"
                  title="Confirm kill"
                  onClick={handleKillConfirm}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button className="ghost icon-btn" title="Cancel" onClick={handleKillCancel}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </>
            ) : (
              <button className="ghost icon-btn danger" title="Kill session" onClick={handleKill}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6" />
                </svg>
              </button>
            ))}
          <button
            className="ghost icon-btn drag-handle"
            title="Drag to swap slots"
            {...attributes}
            {...listeners}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </button>
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

export function EmptySlotPane(props: IDockviewPanelProps) {
  const slot = slotFromEmptySlotId(props.api.id);
  const { setNodeRef, isOver } = useDroppable({ id: String(slot) });
  const className = isOver ? 'pane empty drop-target' : 'pane empty';

  return (
    <div ref={setNodeRef} className={className}>
      Empty slot — click a session to fill it
    </div>
  );
}
