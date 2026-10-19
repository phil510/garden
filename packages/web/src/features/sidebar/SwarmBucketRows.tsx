import type { SessionMap, SessionPlacement } from '@garden/shared';
import { useState } from 'react';
import { useSettingsStore } from '../../state/settingsStore';
import { hideDeadLabel } from './hideDeadLabel';
import type { ActiveSwarmOption, SwarmTreeNode } from './groupSwarms';
import { ShowMoreDeadRow } from './ShowMoreDeadRow';
import { SwarmTree } from './SwarmTree';
import { capDeadForest } from './visibility';

interface SwarmBucketRowsProps {
  roots: SwarmTreeNode[];
  hideDead: boolean;
  onToggleHideDead: () => void;
  sessions: SessionMap;
  placements: Record<string, SessionPlacement>;
  activeSwarms: readonly ActiveSwarmOption[];
  now: number;
  onStageIds: ReadonlySet<string>;
  focusedSessionId: string | null;
  onSelectSession: (id: string) => void;
}

/** The rows of one Swarms bucket (a swarm group or Solo): its tree capped at `deadSessionCap`
 *  dead sessions, the show-more control, and the hide-dead toggle. Holds the bucket's own
 *  expanded state. */
export function SwarmBucketRows({
  roots,
  hideDead,
  onToggleHideDead,
  ...treeProps
}: SwarmBucketRowsProps) {
  const [expanded, setExpanded] = useState(false);
  const deadSessionCap = useSettingsStore((s) => s.deadSessionCap);
  const capped = capDeadForest(
    roots,
    (id) => treeProps.sessions[id]?.liveness === 'dead',
    deadSessionCap,
  );

  return (
    <>
      {roots.length === 0 ? (
        <div className="empty-groups-note">Nothing to show.</div>
      ) : (
        <SwarmTree nodes={expanded ? roots : capped.nodes} {...treeProps} />
      )}
      <ShowMoreDeadRow
        hiddenCount={capped.hiddenDeadCount}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      />
      <div
        className="hide-dead-row"
        title={`${hideDeadLabel(hideDead)} sessions`}
        onClick={onToggleHideDead}
      >
        {hideDeadLabel(hideDead)}
      </div>
    </>
  );
}
