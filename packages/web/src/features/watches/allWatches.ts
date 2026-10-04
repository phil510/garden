import type { SessionState } from '@garden/shared';
import { rowWatchState } from './watchStatus';

export interface WatchGroup {
  session: SessionState;
  pipeFaulted: boolean;
  faulted: boolean;
}

export interface WatchSummary {
  watches: number;
  sessions: number;
  faultedSessions: number;
  pendingDigests: number;
}

function rank(group: WatchGroup): number {
  if (group.faulted) return 0;
  return group.session.watches.some((watch) => watch.pendingDigest) ? 1 : 2;
}

/** Sessions with at least one watch: faults first, then pending digests, then the rest, most
 *  recently active first within each. */
export function collectWatchGroups(
  sessions: readonly SessionState[],
  pipeFaulted: ReadonlySet<string>,
): WatchGroup[] {
  return sessions
    .filter((session) => session.watches.length > 0)
    .map((session) => {
      const faultedPipe = pipeFaulted.has(session.id);
      return {
        session,
        pipeFaulted: faultedPipe,
        faulted: rowWatchState(session, faultedPipe)?.tone === 'fault',
      };
    })
    .sort((a, b) => rank(a) - rank(b) || b.session.lastActivity - a.session.lastActivity);
}

export function summarizeWatchGroups(groups: readonly WatchGroup[]): WatchSummary {
  let watches = 0;
  let pendingDigests = 0;
  for (const { session } of groups) {
    watches += session.watches.length;
    pendingDigests += session.watches.filter((watch) => watch.pendingDigest).length;
  }
  return {
    watches,
    sessions: groups.length,
    faultedSessions: groups.filter((group) => group.faulted).length,
    pendingDigests,
  };
}

/** The top-bar eye's dot: live and dead sessions both count; pending digests never do. */
export function anyFault(groups: readonly WatchGroup[]): boolean {
  return groups.some((group) => group.faulted);
}
