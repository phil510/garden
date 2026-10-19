import type { SessionMap, SessionPlacement } from '@garden/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ActiveSwarmOption, SwarmGroup as SwarmGroupData } from './groupSwarms';
import { SwarmBucketRows } from './SwarmBucketRows';
import { SwarmHeader } from './SwarmHeader';

interface SwarmGroupProps {
  swarm: SwarmGroupData;
  sessions: SessionMap;
  placements: Record<string, SessionPlacement>;
  activeSwarms: readonly ActiveSwarmOption[];
  now: number;
  onStageIds: ReadonlySet<string>;
  focusedSessionId: string | null;
  onToggleCollapse: (swarmId: string) => void;
  onToggleHideDead: (swarmId: string) => void;
  onSelectSession: (id: string) => void;
}

export function SwarmGroup({
  swarm,
  sessions,
  placements,
  activeSwarms,
  now,
  onStageIds,
  focusedSessionId,
  onToggleCollapse,
  onToggleHideDead,
  onSelectSession,
}: SwarmGroupProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: swarm.swarmId,
    // Distinguishes "reorder this swarm against another" (this whole group, still the
    // droppable a header-vs-header drag resolves against) from SwarmHeader's own separate
    // 'swarm-header' droppable, which is what a session drag targets specifically.
    data: { type: 'swarm-reorder', swarmId: swarm.swarmId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div className="swarm-group" ref={setNodeRef} style={style}>
      <SwarmHeader
        swarm={swarm}
        onToggle={() => onToggleCollapse(swarm.swarmId)}
        className={isDragging ? 'dragging' : ''}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
      <div className={`swarm-rows${swarm.collapsed ? ' collapsed' : ''}`}>
        <SwarmBucketRows
          roots={swarm.roots}
          hideDead={swarm.hideDead}
          onToggleHideDead={() => onToggleHideDead(swarm.swarmId)}
          sessions={sessions}
          placements={placements}
          activeSwarms={activeSwarms}
          now={now}
          onStageIds={onStageIds}
          focusedSessionId={focusedSessionId}
          onSelectSession={onSelectSession}
        />
      </div>
    </div>
  );
}
