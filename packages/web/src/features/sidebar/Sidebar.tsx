import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useEffect, useState } from 'react';
import { updateUiState } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { useLocalStore, type SidebarMode } from '../../state/localStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { groupSessions } from './groupSessions';
import { activeSwarmsByRecency, groupSwarms, SOLO_BUCKET_ID } from './groupSwarms';
import type { ActiveSwarmOption } from './groupSwarms';
import { hideDeadLabel } from './hideDeadLabel';
import { NewSessionModal } from './NewSessionModal';
import { placeOnStage } from './placeOnStage';
import { reorderGroups } from './reorderGroups';
import { reorderSwarms } from './reorderSwarms';
import { RepoGroup } from './RepoGroup';
import { focusedSessionId } from './stageFocus';
import { SwarmGroup } from './SwarmGroup';
import { SwarmHeader } from './SwarmHeader';
import { SwarmTree } from './SwarmTree';
import { resolveSwarmScrollAction } from './swarmScrollTarget';
import { toggleHideDeadRepo } from './toggleHideDeadRepo';
import { toggleHideDeadSwarm } from './toggleHideDeadSwarm';
import { toggleRepoCollapse } from './toggleRepoCollapse';
import { toggleSwarmCollapse } from './toggleSwarmCollapse';
import './sidebar.css';

const SIDEBAR_MODES: readonly { mode: SidebarMode; label: string }[] = [
  { mode: 'repos', label: 'Repos' },
  { mode: 'swarms', label: 'Swarms' },
];

export function Sidebar() {
  const sessions = useSessionStore((state) => state.sessions);
  const uiState = useUiStore((state) => state.uiState);
  const sidebarMode = useLocalStore((state) => state.sidebarMode);
  const setSidebarMode = useLocalStore((state) => state.setSidebarMode);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [finishedOpen, setFinishedOpen] = useState(false);

  function selectSession(id: string) {
    updateUiState(placeOnStage(uiState.slots, uiState.focusedSlot, id)).catch(reportCommandFailure);
  }

  const now = Date.now();
  const onStageIds = new Set(uiState.slots.filter((id): id is string => id !== null));
  const focusedId = focusedSessionId(uiState.slots, uiState.focusedSlot);
  // Computed once here rather than inside each mode's sidebar: a session's swarm membership
  // (and the menu that changes it) isn't a Swarms-mode-only concept, so Repos mode needs the
  // same recency-sorted active-swarm list for its own rows' "Add to swarm" menu.
  const activeSwarms = activeSwarmsByRecency(groupSwarms(sessions, uiState).swarms);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  return (
    <>
      <div className="sidebar-toolbar">
        <div className="mode-toggle">
          {SIDEBAR_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              className={`mode-btn${sidebarMode === mode ? ' active' : ''}`}
              onClick={() => setSidebarMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
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
      {sidebarMode === 'repos' ? (
        <RepoSidebar
          sessions={sessions}
          uiState={uiState}
          activeSwarms={activeSwarms}
          now={now}
          onStageIds={onStageIds}
          focusedId={focusedId}
          sensors={sensors}
          onSelectSession={selectSession}
        />
      ) : (
        <SwarmSidebar
          sessions={sessions}
          uiState={uiState}
          activeSwarms={activeSwarms}
          now={now}
          onStageIds={onStageIds}
          focusedId={focusedId}
          sensors={sensors}
          onSelectSession={selectSession}
          finishedOpen={finishedOpen}
          onToggleFinishedOpen={() => setFinishedOpen((open) => !open)}
          onOpenFinished={() => setFinishedOpen(true)}
        />
      )}
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

type SharedSidebarProps = {
  sessions: ReturnType<typeof useSessionStore.getState>['sessions'];
  uiState: ReturnType<typeof useUiStore.getState>['uiState'];
  activeSwarms: readonly ActiveSwarmOption[];
  now: number;
  onStageIds: ReadonlySet<string>;
  focusedId: string | null;
  sensors: ReturnType<typeof useSensors>;
  onSelectSession: (id: string) => void;
};

function RepoSidebar({
  sessions,
  uiState,
  activeSwarms,
  now,
  onStageIds,
  focusedId,
  sensors,
  onSelectSession,
}: SharedSidebarProps) {
  const groups = groupSessions(sessions, uiState);
  const visibleOrder = groups.map((group) => group.repoRoot);

  function toggleCollapse(repoRoot: string) {
    updateUiState({ collapsedRepos: toggleRepoCollapse(uiState.collapsedRepos, repoRoot) }).catch(
      reportCommandFailure,
    );
  }

  function toggleHideDead(repoRoot: string) {
    updateUiState({ hideDeadRepos: toggleHideDeadRepo(uiState.hideDeadRepos, repoRoot) }).catch(
      reportCommandFailure,
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const activeRepoRoot = event.active.id as string;
    const overRepoRoot = event.over?.id as string | undefined;
    if (overRepoRoot === undefined || overRepoRoot === activeRepoRoot) return;
    updateUiState(
      reorderGroups(visibleOrder, uiState.pinnedRepos, activeRepoRoot, overRepoRoot),
    ).catch(reportCommandFailure);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
        {groups.map((group) => (
          <RepoGroup
            key={group.repoRoot}
            group={group}
            sessions={sessions}
            placements={uiState.placements}
            activeSwarms={activeSwarms}
            now={now}
            onStageIds={onStageIds}
            focusedSessionId={focusedId}
            onToggleCollapse={toggleCollapse}
            onToggleHideDead={toggleHideDead}
            onSelectSession={onSelectSession}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

interface SwarmSidebarProps extends SharedSidebarProps {
  finishedOpen: boolean;
  onToggleFinishedOpen: () => void;
  onOpenFinished: () => void;
}

function SwarmSidebar({
  sessions,
  uiState,
  activeSwarms,
  now,
  onStageIds,
  focusedId,
  sensors,
  onSelectSession,
  finishedOpen,
  onToggleFinishedOpen,
  onOpenFinished,
}: SwarmSidebarProps) {
  const { swarms, solo, soloTotal, soloHideDead } = groupSwarms(sessions, uiState);
  const active = swarms.filter((swarm) => !swarm.finished);
  const finished = swarms.filter((swarm) => swarm.finished);
  const selectedSwarmId = useLocalStore((state) => state.selectedSwarmId);
  const setSelectedSwarmId = useLocalStore((state) => state.setSelectedSwarmId);

  // Scrolls to and flashes the swarm a pane-header chip click named. A dead pane can stay on
  // stage after its swarm has gone fully dead/finished, and the Finished section only mounts
  // its rows when open (default closed) — in that case, expand Finished first (without
  // clearing selectedSwarmId) so the next run of this effect, triggered by finishedOpen
  // changing, finds the now-mounted target instead of no-oping.
  // The flash class is removed on the CSS animation's own `animationend` rather than a
  // `setTimeout` twin of its duration: resetting `selectedSwarmId` back to null re-runs this
  // effect (it's a dependency), which would otherwise race a timer-based cleanup into firing
  // early.
  useEffect(() => {
    const action = resolveSwarmScrollAction(
      selectedSwarmId,
      finishedOpen,
      finished.map((swarm) => swarm.swarmId),
    );
    if (action === 'idle') return;
    if (action === 'expand-finished') {
      onOpenFinished();
      return;
    }
    const target = document.querySelector(`[data-swarm-id="${selectedSwarmId}"]`);
    setSelectedSwarmId(null);
    if (target === null) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('flash');
    target.addEventListener('animationend', () => target.classList.remove('flash'), {
      once: true,
    });
  }, [selectedSwarmId, setSelectedSwarmId, finished, finishedOpen, onOpenFinished]);
  const visibleOrder = active.map((swarm) => swarm.swarmId);
  // The base a drag reorders within has to carry every swarm, not just the active ones
  // `SortableContext` renders — `updateUiState` replaces `swarmOrder` wholesale rather than
  // merging (`projection.ts`'s `updateUiState`), so writing back an active-only order would
  // silently drop a finished swarm's position the moment any active swarm gets dragged.
  const fullOrder = swarms.map((swarm) => swarm.swarmId);

  function toggleCollapse(swarmId: string) {
    updateUiState({
      collapsedSwarms: toggleSwarmCollapse(uiState.collapsedSwarms, swarmId),
    }).catch(reportCommandFailure);
  }

  function toggleHideDead(swarmId: string) {
    updateUiState({
      hideDeadSwarms: toggleHideDeadSwarm(uiState.hideDeadSwarms, swarmId),
    }).catch(reportCommandFailure);
  }

  function onDragEnd(event: DragEndEvent) {
    const activeSwarmId = event.active.id as string;
    const overSwarmId = event.over?.id as string | undefined;
    if (overSwarmId === undefined || overSwarmId === activeSwarmId) return;
    updateUiState({
      swarmOrder: reorderSwarms(fullOrder, activeSwarmId, overSwarmId),
    }).catch(reportCommandFailure);
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
          {active.map((swarm) => (
            <SwarmGroup
              key={swarm.swarmId}
              swarm={swarm}
              sessions={sessions}
              placements={uiState.placements}
              activeSwarms={activeSwarms}
              now={now}
              onStageIds={onStageIds}
              focusedSessionId={focusedId}
              onToggleCollapse={toggleCollapse}
              onToggleHideDead={toggleHideDead}
              onSelectSession={onSelectSession}
            />
          ))}
        </SortableContext>
      </DndContext>
      {soloTotal > 0 && (
        <div className="solo-group">
          <div className="solo-header">
            <span className="solo-label upper faint">Solo</span>
            <span className="repo-count mono">{soloTotal}</span>
          </div>
          <div className="solo-rows">
            {solo.length === 0 ? (
              <div className="empty-groups-note">Nothing to show.</div>
            ) : (
              <SwarmTree
                nodes={solo}
                sessions={sessions}
                placements={uiState.placements}
                activeSwarms={activeSwarms}
                now={now}
                onStageIds={onStageIds}
                focusedSessionId={focusedId}
                onSelectSession={onSelectSession}
              />
            )}
            <div
              className="hide-dead-row"
              title={`${hideDeadLabel(soloHideDead)} sessions`}
              onClick={() => toggleHideDead(SOLO_BUCKET_ID)}
            >
              {hideDeadLabel(soloHideDead)}
            </div>
          </div>
        </div>
      )}
      {finished.length > 0 && (
        <div className="finished-section">
          <div
            className={`finished-toggle${finishedOpen ? ' open' : ''}`}
            onClick={onToggleFinishedOpen}
          >
            <svg
              className="chev"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
            <span className="finished-toggle-label upper faint">Finished</span>
            <span className="repo-count mono">{finished.length}</span>
          </div>
          {finishedOpen && (
            <div className="finished-list">
              {finished.map((swarm) => (
                <div className="swarm-group finished" key={swarm.swarmId}>
                  <SwarmHeader swarm={swarm} onToggle={() => toggleCollapse(swarm.swarmId)} />
                  <div className={`swarm-rows${swarm.collapsed ? ' collapsed' : ''}`}>
                    {swarm.roots.length === 0 ? (
                      <div className="empty-groups-note">Nothing to show.</div>
                    ) : (
                      <SwarmTree
                        nodes={swarm.roots}
                        sessions={sessions}
                        placements={uiState.placements}
                        activeSwarms={activeSwarms}
                        now={now}
                        onStageIds={onStageIds}
                        focusedSessionId={focusedId}
                        onSelectSession={onSelectSession}
                      />
                    )}
                    <div
                      className="hide-dead-row"
                      title={`${hideDeadLabel(swarm.hideDead)} sessions`}
                      onClick={() => toggleHideDead(swarm.swarmId)}
                    >
                      {hideDeadLabel(swarm.hideDead)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
