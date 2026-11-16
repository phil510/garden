import { randomUUID } from 'node:crypto';
import type { EffortLevel, SessionState } from '@garden/shared';
import type { PermissionMode } from '../config.js';
import { withoutAlert } from '../domain/alerts.js';
import { deriveTmuxName } from '../domain/tmuxName.js';
import { SessionNotFoundError, SessionMessagingError } from './errors.js';
import type { HarnessPort, TmuxPaneFact, TmuxPort } from './ports.js';
import type { Projection } from './projection.js';
import { recordSpawn, setArchived } from './swarms.js';

export { SessionNotFoundError } from './errors.js';

export interface CreateSessionRequest {
  readonly cwd: string;
  readonly callerSessionId?: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
}

export interface CreateSessionResult {
  readonly id: string;
  readonly tmuxName: string;
  /** Set when `callerSessionId` was forwarded but doesn't name a session garden knows
   *  about. Never sent on the wire — `http/routes/sessions.ts` turns it into a stderr
   *  warning instead. */
  readonly unknownCaller?: boolean;
}

export interface ResumeSessionRequest {
  readonly id: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
}

export interface ResumeSessionResult {
  readonly id: string;
  readonly tmuxName: string;
}

export interface KillSessionRequest {
  readonly id: string;
}

export interface SessionsDeps {
  readonly tmux: TmuxPort;
  readonly projection: Projection;
  readonly serverPort: number;
  readonly harness: Pick<
    HarnessPort,
    'spawnCommand' | 'resumeCommand' | 'initialStatus' | 'beforeLaunch' | 'sendMessage'
  >;
  readonly permissionMode?: PermissionMode;
}

export function findSession(projection: Projection, id: string): SessionState {
  const session = projection.sessions().find((candidate) => candidate.id === id);
  if (session === undefined) throw new SessionNotFoundError(`no such session: ${id}`);
  return session;
}

/** Every tmux name currently in use, from the two sources that can each hold one the
 *  other doesn't: the projection's own sessions, and every live pane tmux reports —
 *  the pane list is what catches a session the projection has lost track of (a dead
 *  or never-transcribed pane still holding its name). `excludeId` drops the session
 *  being resumed, whose own stale name must not block reusing it. */
function takenTmuxNames(
  projection: Projection,
  panes: readonly TmuxPaneFact[],
  excludeId?: string,
): string[] {
  return [
    ...projection
      .sessions()
      .filter((session) => session.id !== excludeId)
      .map((session) => session.tmuxName)
      .filter((name): name is string => name !== null),
    ...panes.map((pane) => pane.session),
  ];
}

/**
 * Mints a session id, derives a tmux name unique against every session the
 * projection already knows about, and starts tmux running the harness before the
 * session is registered — a tmux failure must never produce a session with no
 * process behind it.
 */
export async function createSession(
  deps: SessionsDeps,
  request: CreateSessionRequest,
): Promise<CreateSessionResult> {
  const { tmux, projection, serverPort, harness, permissionMode } = deps;

  const panes = await tmux.listPanes();
  const takenNames = takenTmuxNames(projection, panes);
  const id = randomUUID();
  const tmuxName = deriveTmuxName(request.cwd, takenNames);

  const launchRequest = {
    id,
    cwd: request.cwd,
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.effort === undefined ? {} : { effort: request.effort }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
  };
  const command = harness.spawnCommand(launchRequest);
  const launch = harness.beforeLaunch?.(launchRequest);
  try {
    await tmux.newSession({
      name: tmuxName,
      cwd: request.cwd,
      port: serverPort,
      sessionId: id,
      command,
    });
  } catch (error) {
    launch?.rollback();
    throw error;
  }
  const reported = launch === undefined ? harness.initialStatus : launch.registrationStatus();

  projection.dispatch({
    type: 'session-registered',
    id,
    tmuxName,
    cwd: request.cwd,
    ...(reported === undefined ? {} : { reported }),
  });

  if (request.callerSessionId === undefined) return { id, tmuxName };

  const callerTitle =
    projection.sessions().find((session) => session.id === request.callerSessionId)?.title ?? null;
  try {
    recordSpawn({ projection }, { callerId: request.callerSessionId, childId: id, callerTitle });
  } catch (error) {
    if (!(error instanceof SessionNotFoundError)) throw error;
    return { id, tmuxName, unknownCaller: true };
  }
  return { id, tmuxName };
}

/** If the resumed session resolves to a top-level swarm that is currently archived, clears
 *  that flag so the swarm returns to the main list — the other half of "resuming a member
 *  un-finishes its swarm" (the all-members-dead half needs no server change, since that's a
 *  pure function of liveness the client already recomputes). Reuses `setArchived`'s write
 *  rather than duplicating it; only called once the swarm is confirmed to exist and be
 *  archived, so it never hits that function's not-found throw. */
function unarchiveResumedSwarm(deps: SessionsDeps, sessionId: string): void {
  const swarmId = deps.projection.placementOf(sessionId)?.topLevelSwarmId;
  if (swarmId === undefined) return;
  const swarm = deps.projection.uiState().swarms.find((candidate) => candidate.id === swarmId);
  if (swarm?.archived === true) setArchived(deps, swarmId, false);
}

/**
 * Resumes a dead session by whichever mechanism fits: `respawn-pane` in place when
 * tmux still holds the session (a dead pane kept by `remain-on-exit`), otherwise a
 * fresh tmux session at the recorded cwd. The session id never changes either way.
 */
export async function resumeSession(
  deps: SessionsDeps,
  request: ResumeSessionRequest,
): Promise<ResumeSessionResult> {
  const { tmux, projection, serverPort, harness, permissionMode } = deps;
  const session = findSession(projection, request.id);
  const launchRequest = {
    id: request.id,
    cwd: session.cwd,
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.effort === undefined ? {} : { effort: request.effort }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
  };
  const panes = await tmux.listPanes();
  const priorName = session.tmuxName;

  const launch = harness.beforeLaunch?.(launchRequest);
  const reusePane = priorName !== null && panes.some((pane) => pane.session === priorName);
  const tmuxName = reusePane
    ? priorName
    : deriveTmuxName(session.cwd, takenTmuxNames(projection, panes, request.id));
  try {
    const command = harness.resumeCommand(launchRequest);
    if (reusePane) await tmux.respawnPane({ name: tmuxName, command });
    else
      await tmux.newSession({
        name: tmuxName,
        cwd: session.cwd,
        port: serverPort,
        sessionId: session.id,
        command,
      });
  } catch (error) {
    launch?.rollback();
    throw error;
  }
  const reported = launch === undefined ? harness.initialStatus : launch.registrationStatus();
  projection.dispatch({
    type: 'session-registered',
    id: request.id,
    tmuxName,
    cwd: session.cwd,
    ...(reported === undefined ? {} : { reported }),
  });
  const result = { id: request.id, tmuxName };

  unarchiveResumedSwarm(deps, request.id);
  return result;
}

/**
 * Kills the tmux session and unregisters its name, so the session reads `dead` with no tmux
 * name straight away rather than after the next tmux snapshot. A deliberate kill also clears
 * the session's alert; a session that dies on its own keeps it.
 */
export async function killSession(deps: SessionsDeps, request: KillSessionRequest): Promise<void> {
  const { tmux, projection } = deps;
  const session = findSession(projection, request.id);
  if (session.tmuxName !== null) await tmux.killSession(session.tmuxName);
  projection.dispatch({ type: 'session-unregistered', id: request.id });
  // Re-read: the dying agent may have raised an alert while the tmux kill was in flight.
  if (findSession(projection, request.id).alert !== null) {
    projection.updateOverlay((base) => withoutAlert(base, request.id));
    projection.dispatch({ type: 'alert-changed', sessionId: request.id, alert: null });
  }
}

export async function sendSessionMessage(
  deps: SessionsDeps,
  id: string,
  message: string,
): Promise<void> {
  findSession(deps.projection, id);
  if (deps.harness.sendMessage === undefined)
    throw new SessionMessagingError('garden send is supported only by the Codex harness');
  await deps.harness.sendMessage(id, message, async () => {
    const current = findSession(deps.projection, id);
    const panes = await deps.tmux.listPanes();
    if (
      current.tmuxName === null ||
      !panes.some((pane) => pane.session === current.tmuxName && !pane.dead)
    )
      throw new SessionMessagingError(
        'Resume this pending session before sending its first message',
      );
    if (deps.tmux.submitMessage === undefined)
      throw new SessionMessagingError('Pending session delivery is unavailable');
    await deps.tmux.submitMessage(current.tmuxName, message);
  });
}
