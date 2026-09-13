import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState } from 'react';
import { updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { groupSessions } from './groupSessions';
import { NewSessionModal } from './NewSessionModal';
import { placeOnStage } from './placeOnStage';
import { reorderGroups } from './reorderGroups';
import { RepoGroup } from './RepoGroup';
import { focusedSessionId } from './stageFocus';
import { toggleRepoCollapse } from './toggleRepoCollapse';
import './sidebar.css';

export function Sidebar() {
  const sessions = useSessionStore((state) => state.sessions);
  const uiState = useUiStore((state) => state.uiState);
  const groups = groupSessions(sessions, uiState);
  const [pickerOpen, setPickerOpen] = useState(false);

  function toggleCollapse(repoRoot: string) {
    updateUiState({ collapsedRepos: toggleRepoCollapse(uiState.collapsedRepos, repoRoot) }).catch(
      reportCommandFailure,
    );
  }

  function toggleHideDead() {
    updateUiState({ hideDead: !uiState.hideDead }).catch(reportCommandFailure);
  }

  function selectSession(id: string) {
    updateUiState(placeOnStage(uiState.slots, uiState.focusedSlot, id)).catch(reportCommandFailure);
  }

  const now = Date.now();
  const onStageIds = new Set(uiState.slots.filter((id): id is string => id !== null));
  const focusedId = focusedSessionId(uiState.slots, uiState.focusedSlot);
  const visibleOrder = groups.map((group) => group.repoRoot);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function onDragEnd(event: DragEndEvent) {
    const activeRepoRoot = event.active.id as string;
    const overRepoRoot = event.over?.id as string | undefined;
    if (overRepoRoot === undefined || overRepoRoot === activeRepoRoot) return;
    updateUiState(
      reorderGroups(visibleOrder, uiState.pinnedRepos, activeRepoRoot, overRepoRoot),
    ).catch(reportCommandFailure);
  }

  return (
    <>
      <div className="sidebar-toolbar">
        <button
          className={`toggle-pill${uiState.hideDead ? ' on' : ''}`}
          title="Hide dead sessions"
          onClick={toggleHideDead}
        >
          <span className="dot" />
          <span>Hide dead</span>
        </button>
        <button className="btn-new" onClick={() => setPickerOpen(true)}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>New session</span>
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
          {groups.map((group) => (
            <RepoGroup
              key={group.repoRoot}
              group={group}
              sessions={sessions}
              hideDead={uiState.hideDead}
              now={now}
              onStageIds={onStageIds}
              focusedSessionId={focusedId}
              onToggleCollapse={toggleCollapse}
              onSelectSession={selectSession}
            />
          ))}
        </SortableContext>
      </DndContext>
      {pickerOpen && (
        <NewSessionModal
          onClose={() => setPickerOpen(false)}
          onCreated={(id) => {
            selectSession(id);
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}
