import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { updateUiState } from '../../api/client';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { groupSessions } from './groupSessions';
import { placeOnStage } from './placeOnStage';
import { reorderGroups } from './reorderGroups';
import { RepoGroup } from './RepoGroup';
import './sidebar.css';

export function Sidebar() {
  const sessions = useSessionStore((state) => state.sessions);
  const uiState = useUiStore((state) => state.uiState);
  const groups = groupSessions(sessions, uiState);

  function toggleCollapse(repoRoot: string) {
    const collapsedRepos = uiState.collapsedRepos.includes(repoRoot)
      ? uiState.collapsedRepos.filter((root) => root !== repoRoot)
      : [...uiState.collapsedRepos, repoRoot];
    void updateUiState({ collapsedRepos });
  }

  function toggleHideDead() {
    void updateUiState({ hideDead: !uiState.hideDead });
  }

  function selectSession(id: string) {
    void updateUiState(placeOnStage(uiState.slots, uiState.focusedSlot, id));
  }

  const onStageIds = new Set(uiState.slots.filter((id): id is string => id !== null));
  const visibleOrder = groups.map((group) => group.repoRoot);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function onDragEnd(event: DragEndEvent) {
    const activeRepoRoot = event.active.id as string;
    const overRepoRoot = event.over?.id as string | undefined;
    if (overRepoRoot === undefined || overRepoRoot === activeRepoRoot) return;
    void updateUiState(
      reorderGroups(visibleOrder, uiState.pinnedRepos, activeRepoRoot, overRepoRoot),
    );
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
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
          {groups.map((group) => (
            <RepoGroup
              key={group.repoRoot}
              group={group}
              sessions={sessions}
              hideDead={uiState.hideDead}
              onStageIds={onStageIds}
              onToggleCollapse={toggleCollapse}
              onSelectSession={selectSession}
            />
          ))}
        </SortableContext>
      </DndContext>
    </>
  );
}
