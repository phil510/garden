import type { SessionMap, SessionPlacement } from '@garden/shared';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { ActiveSwarmOption, SwarmTreeNode } from './groupSwarms';
import { resolveTopLevelSwarmId } from './groupSwarms';
import { SessionRow } from './SessionRow';

interface SwarmTreeProps {
  nodes: SwarmTreeNode[];
  sessions: SessionMap;
  placements: Record<string, SessionPlacement>;
  activeSwarms: readonly ActiveSwarmOption[];
  now: number;
  onStageIds: ReadonlySet<string>;
  focusedSessionId: string | null;
  onSelectSession: (id: string) => void;
}

/** Renders a forest of `SwarmTreeNode`s: each root is a bare `SessionRow` (no `<li>`, no
 *  `has-children` rail-continuation neighbor — its own corner comes from
 *  `.session-row.has-children::after`), followed by a `<ul class="tree-children">` of its
 *  descendants when it has any. Whether a child is the last of its siblings is left to
 *  CSS's own `:last-child` — the DOM order already carries that, so nothing here needs to
 *  compute or pass it down. */
export function SwarmTree({
  nodes,
  sessions,
  placements,
  activeSwarms,
  now,
  onStageIds,
  focusedSessionId,
  onSelectSession,
}: SwarmTreeProps) {
  return (
    <>
      {nodes.map((node) => (
        <SwarmTreeRow
          key={node.sessionId}
          node={node}
          sessions={sessions}
          placements={placements}
          activeSwarms={activeSwarms}
          now={now}
          onStageIds={onStageIds}
          focusedSessionId={focusedSessionId}
          onSelectSession={onSelectSession}
        />
      ))}
    </>
  );
}

interface SwarmTreeRowProps extends Omit<SwarmTreeProps, 'nodes'> {
  node: SwarmTreeNode;
}

function SwarmTreeRow({
  node,
  sessions,
  placements,
  activeSwarms,
  now,
  onStageIds,
  focusedSessionId,
  onSelectSession,
}: SwarmTreeRowProps) {
  // Membership drag lives here, Swarms-mode only — RepoGroup renders SessionRow directly with
  // no drag props at all, so a session never becomes draggable inside RepoSidebar's separate
  // DndContext (whose own onDragEnd also bails on a foreign active type, defense in depth).
  // Keyed on node.sessionId, not session.id below, so this hook call stays unconditional ahead
  // of the missing-session guard (Rules of Hooks) — they're the same id whenever session exists.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: node.sessionId,
    data: { type: 'session', sessionId: node.sessionId },
  });

  const session = sessions[node.sessionId];
  // Every node is built from a live SessionState (groupSwarms.ts only ever nests known
  // sessions), so this is unreachable in practice — guarded rather than asserted, since a
  // missing row should disappear quietly instead of crashing the sidebar.
  if (session === undefined) return null;

  return (
    <>
      <SessionRow
        session={session}
        onStage={onStageIds.has(session.id)}
        focused={focusedSessionId === session.id}
        now={now}
        onSelect={onSelectSession}
        currentSwarmId={resolveTopLevelSwarmId(placements, session.id)}
        activeSwarms={activeSwarms}
        hasChildren={node.children.length > 0}
        dragRef={setNodeRef}
        dragAttributes={attributes}
        dragListeners={listeners}
        dragStyle={{ transform: CSS.Translate.toString(transform) }}
        isDragging={isDragging}
      />
      {node.children.length > 0 && (
        <ul className="tree-children">
          {node.children.map((child) => (
            <li className="tree-node" key={child.sessionId}>
              <SwarmTreeRow
                node={child}
                sessions={sessions}
                placements={placements}
                activeSwarms={activeSwarms}
                now={now}
                onStageIds={onStageIds}
                focusedSessionId={focusedSessionId}
                onSelectSession={onSelectSession}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
