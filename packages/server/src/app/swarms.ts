import { randomUUID } from 'node:crypto';
import type { Placement, SessionPlacement, SwarmRecord, UiState } from '@garden/shared';
import { pruneOverlay, resolveSwarmId, validatePlacement } from '../domain/swarms.js';
import { SessionNotFoundError } from './errors.js';
import type { OverlayState } from './ports.js';
import type { Projection } from './projection.js';

export interface SwarmsDeps {
  readonly projection: Projection;
}

export class SwarmNotFoundError extends Error {}
export class SwarmCycleError extends Error {}

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

/** The overlay with `patch` laid over its `ui`; every swarm and placement write goes through here. */
function withUi(base: OverlayState, patch: Partial<UiState>): OverlayState {
  return { ...base, ui: { ...base.ui, ...patch } };
}

function findSwarm(base: OverlayState, id: string): SwarmRecord {
  const swarm = base.ui.swarms.find((candidate) => candidate.id === id);
  if (swarm === undefined) throw new SwarmNotFoundError(`no such swarm: ${id}`);
  return swarm;
}

export function createSwarm(deps: SwarmsDeps, request: { name: string }): { id: string } {
  const id = randomUUID();
  deps.projection.updateOverlay((base) =>
    withUi(base, { swarms: [...base.ui.swarms, { id, name: request.name, archived: false }] }),
  );
  return { id };
}

export function renameSwarm(deps: SwarmsDeps, request: { id: string; name: string }): void {
  deps.projection.updateOverlay((base) => {
    findSwarm(base, request.id);
    return withUi(base, {
      swarms: base.ui.swarms.map((swarm) =>
        swarm.id === request.id ? { ...swarm, name: request.name } : swarm,
      ),
    });
  });
}

/** Exported for `resumeSession` (`app/sessions.ts`), which clears a swarm's `archived` flag
 *  when a resumed session belongs to one — the only other write site for this flag besides
 *  `archiveSwarm`/`unarchiveSwarm` themselves. */
export function setArchived(deps: SwarmsDeps, id: string, archived: boolean): void {
  deps.projection.updateOverlay((base) => {
    findSwarm(base, id);
    return withUi(base, {
      swarms: base.ui.swarms.map((swarm) => (swarm.id === id ? { ...swarm, archived } : swarm)),
    });
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
    const placements: Record<string, SessionPlacement> = { ...base.ui.placements };
    for (const [sessionId, entry] of Object.entries(placements)) {
      if (entry.swarmId !== request.id) continue;
      const next = { ...entry };
      delete next.swarmId;
      placements[sessionId] = next;
    }
    return withUi(base, {
      swarms: base.ui.swarms.filter((swarm) => swarm.id !== request.id),
      placements,
    });
  });
}

/**
 * The one placement endpoint: sets `sessionId`'s placement to exactly one of a swarm, a
 * parent, or none. Checks `sessionId` and the target both exist before calling into
 * `domain/swarms.ts` — a dangling reference must never be writable in the first place.
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

    const entry: SessionPlacement =
      request.placement.type === 'swarm'
        ? { swarmId: request.placement.swarmId }
        : request.placement.type === 'parent'
          ? { parent: request.placement.parentId }
          : {};

    return withUi(base, { placements: { ...base.ui.placements, [request.sessionId]: entry } });
  });
}

// A caller that already resolves to a swarm, or that already carries a `parent` edge of
// its own (set by the placement endpoint, independent of any swarm), is not the "isn't
// placed at all" case `mintSwarmFor` exists to handle — minting over it would silently
// replace that `parent` edge, since `parent` and `swarmId` can never both be set (finding:
// a caller placed under another session via `POST /sessions/:id/placement`, whose ancestor
// chain doesn't currently resolve to a swarm, lost its `parent` link the first time it
// spawned).
function isUnplaced(base: OverlayState, id: string): boolean {
  return (
    resolveSwarmId(base.ui.placements, id) === undefined &&
    base.ui.placements[id]?.parent === undefined
  );
}

/**
 * Mints a fresh swarm and places `id` at its top level. Callers check `isUnplaced` first;
 * this always mints unconditionally.
 */
function mintSwarmFor(base: OverlayState, id: string, title: string | null): OverlayState {
  const swarmId = randomUUID();
  return withUi(base, {
    swarms: [...base.ui.swarms, { id: swarmId, name: title ?? 'Untitled swarm', archived: false }],
    placements: { ...base.ui.placements, [id]: { swarmId } },
  });
}

/**
 * Called right after a new session's tmux process and store entry exist, when its create
 * request named a caller session. Places the child under the caller, creating a swarm for
 * the caller first if it has none yet — one `updateOverlay` call so the swarm-creation,
 * caller-placement, and child-placement writes land atomically.
 */
export function recordSpawn(
  deps: SwarmsDeps,
  request: { callerId: string; childId: string; callerTitle: string | null },
): void {
  deps.projection.updateOverlay((base) => {
    const known = knownSessionIds(deps, base);
    if (!known.has(request.callerId))
      throw new SessionNotFoundError(`no such session: ${request.callerId}`);

    const withSwarm = isUnplaced(base, request.callerId)
      ? mintSwarmFor(base, request.callerId, request.callerTitle)
      : base;

    return withUi(withSwarm, {
      placements: {
        ...withSwarm.ui.placements,
        [request.childId]: { parent: request.callerId },
      },
    });
  });
}

/**
 * Called once, right after boot replay finishes (`main.ts`) — not an event listener, since
 * pruning only ever needs to run the one time replay has settled what "known" means. Known
 * ids are the same union `placeSession`/`recordSpawn` check targets against. Only writes
 * when pruning actually changed something, so a boot with nothing stale to drop does not
 * touch `uiState()`/its subscribers.
 */
export function pruneKnownSessions(deps: SwarmsDeps): void {
  deps.projection.updateOverlay((base) => pruneOverlay(base, knownSessionIds(deps, base)));
}
