import { randomUUID } from 'node:crypto';
import type { Placement, SessionPlacement, SwarmRecord } from '@garden/shared';
import { computeHandoff, pruneOverlay, validatePlacement } from '../domain/swarms.js';
import type { OverlayState } from './ports.js';
import type { Projection } from './projection.js';
import { SessionNotFoundError } from './sessions.js';

export interface SwarmsDeps {
  readonly projection: Projection;
}

export class SwarmNotFoundError extends Error {}
export class SwarmCycleError extends Error {}
export class CrossSwarmHandoffError extends Error {}

/** Every session id known to the running server, from the two sources that can each hold
 *  one the other doesn't: the projection's own sessions, and the store's `tmuxNames` — the
 *  latter is what keeps a just-spawned child (registered in `tmuxNames` at spawn time, but
 *  with no transcript yet) a valid placement target, the same union `pruneKnownSessions`
 *  uses to decide what survives a restart. */
function knownSessionIds(deps: SwarmsDeps, base: OverlayState): ReadonlySet<string> {
  return new Set([
    ...deps.projection.sessions().map((session) => session.id),
    ...Object.keys(base.tmuxNames),
  ]);
}

function findSwarm(base: OverlayState, id: string): SwarmRecord {
  const swarm = base.swarms.find((candidate) => candidate.id === id);
  if (swarm === undefined) throw new SwarmNotFoundError(`no such swarm: ${id}`);
  return swarm;
}

export function createSwarm(deps: SwarmsDeps, request: { name: string }): { id: string } {
  const id = randomUUID();
  deps.projection.updateOverlay((base) => ({
    ...base,
    swarms: [...base.swarms, { id, name: request.name, archived: false }],
  }));
  return { id };
}

export function renameSwarm(deps: SwarmsDeps, request: { id: string; name: string }): void {
  deps.projection.updateOverlay((base) => {
    findSwarm(base, request.id);
    return {
      ...base,
      swarms: base.swarms.map((swarm) =>
        swarm.id === request.id ? { ...swarm, name: request.name } : swarm,
      ),
    };
  });
}

/** Exported for `resumeSession` (`app/sessions.ts`), which clears a swarm's `archived` flag
 *  when a resumed session belongs to one — the only other write site for this flag besides
 *  `archiveSwarm`/`unarchiveSwarm` themselves. */
export function setArchived(deps: SwarmsDeps, id: string, archived: boolean): void {
  deps.projection.updateOverlay((base) => {
    findSwarm(base, id);
    return {
      ...base,
      swarms: base.swarms.map((swarm) => (swarm.id === id ? { ...swarm, archived } : swarm)),
    };
  });
}

export function archiveSwarm(deps: SwarmsDeps, request: { id: string }): void {
  setArchived(deps, request.id, true);
}

export function unarchiveSwarm(deps: SwarmsDeps, request: { id: string }): void {
  setArchived(deps, request.id, false);
}

/** Members become solo — their `parent` edges (if any) survive; only the `swarmId` link to
 *  the deleted swarm is cleared. Nothing is killed. */
export function deleteSwarm(deps: SwarmsDeps, request: { id: string }): void {
  deps.projection.updateOverlay((base) => {
    findSwarm(base, request.id);
    const placements: Record<string, SessionPlacement> = { ...base.placements };
    for (const [sessionId, entry] of Object.entries(placements)) {
      if (entry.swarmId !== request.id) continue;
      const next = { ...entry };
      delete next.swarmId;
      placements[sessionId] = next;
    }
    return { ...base, swarms: base.swarms.filter((swarm) => swarm.id !== request.id), placements };
  });
}

/**
 * The one placement endpoint: sets `sessionId`'s placement to exactly one of a swarm, a
 * parent, or none. Checks `sessionId` and the target both exist before calling into
 * `domain/swarms.ts` — a dangling reference must never be writable in the first place —
 * then preserves an existing `successor` field a prior handoff set, since a placement move
 * only ever overwrites `parent`/`swarmId`.
 */
export function placeSession(
  deps: SwarmsDeps,
  request: { sessionId: string; placement: Placement },
): void {
  deps.projection.updateOverlay((base) => {
    const known = knownSessionIds(deps, base);
    if (!known.has(request.sessionId))
      throw new SessionNotFoundError(`no such session: ${request.sessionId}`);
    if (request.placement.type === 'parent' && !known.has(request.placement.parentId))
      throw new SessionNotFoundError(`no such session: ${request.placement.parentId}`);

    const result = validatePlacement(base, request.sessionId, request.placement);
    if (!result.ok) {
      throw request.placement.type === 'swarm'
        ? new SwarmNotFoundError(result.reason)
        : new SwarmCycleError(result.reason);
    }

    const prior = base.placements[request.sessionId];
    const entry: SessionPlacement =
      request.placement.type === 'swarm'
        ? { swarmId: request.placement.swarmId }
        : request.placement.type === 'parent'
          ? { parent: request.placement.parentId }
          : {};
    if (prior?.successor !== undefined) entry.successor = prior.successor;

    return { ...base, placements: { ...base.placements, [request.sessionId]: entry } };
  });
}

export function handoffSession(deps: SwarmsDeps, request: { fromId: string; toId: string }): void {
  deps.projection.updateOverlay((base) => {
    const known = knownSessionIds(deps, base);
    if (!known.has(request.fromId))
      throw new SessionNotFoundError(`no such session: ${request.fromId}`);
    if (!known.has(request.toId))
      throw new SessionNotFoundError(`no such session: ${request.toId}`);

    const result = computeHandoff(base, request.fromId, request.toId);
    if (!result.ok) {
      throw result.code === 'cross-swarm'
        ? new CrossSwarmHandoffError(result.reason)
        : new SwarmCycleError(result.reason);
    }

    return { ...base, placements: result.placements };
  });
}

/**
 * Called once, right after boot replay finishes (`main.ts`) — not an event listener, since
 * pruning only ever needs to run the one time replay has settled what "known" means. Known
 * ids are the same union `placeSession`/`handoffSession` check targets against. Only writes
 * when pruning actually changed something, so a boot with nothing stale to drop does not
 * touch `uiState()`/its subscribers.
 */
export function pruneKnownSessions(deps: SwarmsDeps): void {
  deps.projection.updateOverlay((base) => pruneOverlay(base, knownSessionIds(deps, base)));
}
