import type { SessionMap } from '@garden/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, type KeyboardEvent } from 'react';
import type { SidebarGroup } from './groupSessions';
import { SessionRow } from './SessionRow';
import {
  capDeadSessions,
  hiddenCappedDeadCount,
  hiddenOldDeadCount,
  visibleSessions,
} from './visibility';

interface RepoGroupProps {
  group: SidebarGroup;
  sessions: SessionMap;
  hideDead: boolean;
  now: number;
  onStageIds: ReadonlySet<string>;
  focusedSessionId: string | null;
  onToggleCollapse: (repoRoot: string) => void;
  onSelectSession: (id: string) => void;
}

export function RepoGroup({
  group,
  sessions,
  hideDead,
  now,
  onStageIds,
  focusedSessionId,
  onToggleCollapse,
  onSelectSession,
}: RepoGroupProps) {
  const [showOlder, setShowOlder] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: group.repoRoot,
  });

  function toggle() {
    onToggleCollapse(group.repoRoot);
  }

  function onHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  }

  const members = group.sessionIds
    .map((id) => sessions[id])
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  const visible = visibleSessions(members, { hideDead, showOlder }, now);
  const hiddenCount = hiddenOldDeadCount(members, hideDead, now);
  const capped = capDeadSessions(visible, expanded);
  const hiddenCappedCount = hiddenCappedDeadCount(visible);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div className="repo-group" ref={setNodeRef} style={style}>
      <div
        className={`repo-header${group.collapsed ? ' collapsed' : ''}${isDragging ? ' dragging' : ''}`}
        onClick={toggle}
        onKeyDown={onHeaderKeyDown}
        {...attributes}
        {...listeners}
      >
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="repo-name">{group.repoName}</span>
        {group.attention && <span className="attn-badge" title="Needs attention" />}
        <span className="repo-count mono">{group.liveCount} live</span>
      </div>
      <div className={`repo-rows${group.collapsed ? ' collapsed' : ''}`}>
        {capped.length === 0 && <div className="empty-groups-note">Nothing to show.</div>}
        {capped.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            onStage={onStageIds.has(session.id)}
            focused={focusedSessionId === session.id}
            now={now}
            onSelect={onSelectSession}
          />
        ))}
        {hiddenCappedCount > 0 && (
          <div className="show-older-row" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show ${hiddenCappedCount} more…`}
          </div>
        )}
        {!showOlder && hiddenCount > 0 && (
          <div className="show-older-row" onClick={() => setShowOlder(true)}>
            Show {hiddenCount} older dead session{hiddenCount === 1 ? '' : 's'}…
          </div>
        )}
      </div>
    </div>
  );
}
