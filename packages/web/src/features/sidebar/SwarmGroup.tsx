import type { SessionMap, SessionPlacement } from '@garden/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { hideDeadLabel } from './hideDeadLabel';
import type { SwarmGroup as SwarmGroupData } from './groupSwarms';
import { SwarmHeader } from './SwarmHeader';
import { SwarmTree } from './SwarmTree';

interface SwarmGroupProps {
  swarm: SwarmGroupData;
  sessions: SessionMap;
  placements: Record<string, SessionPlacement>;
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
  now,
  onStageIds,
  focusedSessionId,
  onToggleCollapse,
  onToggleHideDead,
  onSelectSession,
}: SwarmGroupProps) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: swarm.swarmId,
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
        {swarm.roots.length === 0 ? (
          <div className="empty-groups-note">Nothing to show.</div>
        ) : (
          <SwarmTree
            nodes={swarm.roots}
            sessions={sessions}
            placements={placements}
            now={now}
            onStageIds={onStageIds}
            focusedSessionId={focusedSessionId}
            onSelectSession={onSelectSession}
          />
        )}
        <div
          className="hide-dead-row"
          title={`${hideDeadLabel(swarm.hideDead)} sessions`}
          onClick={() => onToggleHideDead(swarm.swarmId)}
        >
          {hideDeadLabel(swarm.hideDead)}
        </div>
      </div>
    </div>
  );
}
