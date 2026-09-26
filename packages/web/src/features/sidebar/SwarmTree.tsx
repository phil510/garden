import type { SessionMap, SessionPlacement } from '@garden/shared';
import type { SwarmTreeNode } from './groupSwarms';
import { SessionRow } from './SessionRow';
import { resolveSuccessorName } from './successorName';

interface SwarmTreeProps {
  nodes: SwarmTreeNode[];
  sessions: SessionMap;
  placements: Record<string, SessionPlacement>;
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
  now,
  onStageIds,
  focusedSessionId,
  onSelectSession,
}: SwarmTreeRowProps) {
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
        successorName={resolveSuccessorName(placements, sessions, session.id)}
        hasChildren={node.children.length > 0}
      />
      {node.children.length > 0 && (
        <ul className="tree-children">
          {node.children.map((child) => (
            <li className="tree-node" key={child.sessionId}>
              <SwarmTreeRow
                node={child}
                sessions={sessions}
                placements={placements}
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
