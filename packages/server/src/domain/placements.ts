import type { SessionPlacement, SessionState } from '@garden/shared';
import { resolveSwarmId } from './swarms.js';

type Placements = Readonly<Record<string, SessionPlacement>>;

/** Merges each session's placement entry onto it, producing the `parent`/`swarmId`/
 *  `successor` fields `ls --json` exposes. A session with no entry in `placements` is
 *  returned untouched — those three fields stay absent, not present-and-undefined. */
export function mergePlacements(sessions: SessionState[], placements: Placements): SessionState[] {
  return sessions.map((session) => {
    const entry = placements[session.id];
    return entry === undefined ? session : { ...session, ...entry };
  });
}

/** Keeps only the sessions that resolve to `swarmId`. Takes `placements` separately from
 *  `sessions` rather than reading it off each session's own merged fields: a session's
 *  swarm membership can depend on an ancestor's placement entry even when that ancestor
 *  isn't itself present in `sessions` (a dead, filtered-out orchestrator whose live child
 *  still belongs to the swarm) — `resolveSwarmId` walks the full map directly, independent
 *  of which sessions are in the list being filtered. */
export function filterBySwarm(
  sessions: SessionState[],
  placements: Placements,
  swarmId: string,
): SessionState[] {
  return sessions.filter((session) => resolveSwarmId(placements, session.id) === swarmId);
}
