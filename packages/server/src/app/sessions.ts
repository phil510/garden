import { randomUUID } from 'node:crypto';
import type { EffortLevel, SessionState } from '@garden/shared';
import type { PermissionMode } from '../config.js';
import { deriveTmuxName } from '../domain/tmuxName.js';
import { SessionNotFoundError } from './errors.js';
import type { TmuxPaneFact, TmuxPort } from './ports.js';
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

/** The pieces `main.ts` binds once: the tmux target, the local server's own port, and
 *  the settings file every spawned Claude Code process is told to load.
 *
 *  `readClaudeCommand` is a function, not a value, because it must reflect a `claudeCommand`
 *  saved to `config.json` after boot without restarting garden — `main.ts` binds it to a
 *  fresh `configPort.read()` on every call, unlike `permissionMode`, which stays a boot-time
 *  snapshot. */
export interface SessionsDeps {
  readonly tmux: TmuxPort;
  readonly projection: Projection;
  readonly serverPort: number;
  readonly settingsPath: string;
  readonly readClaudeCommand: () => readonly string[];
  readonly permissionMode?: PermissionMode;
}

/** No flag by default; `'bypassPermissions'` is the only mode that adds one. */
function permissionFlags(mode: PermissionMode | undefined): readonly string[] {
  return mode === 'bypassPermissions' ? ['--permission-mode', 'bypassPermissions'] : [];
}

/** `--model` / `--effort` for the spawned `claude`, each only when given. */
function spawnFlags(request: {
  readonly model?: string;
  readonly effort?: EffortLevel;
}): readonly string[] {
  return [
    ...(request.model === undefined ? [] : ['--model', request.model]),
    ...(request.effort === undefined ? [] : ['--effort', request.effort]),
  ];
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
 * projection already knows about, and starts tmux running Claude Code before the
 * session is registered — a tmux failure must never produce a session with no
 * process behind it.
 */
export async function createSession(
  deps: SessionsDeps,
  request: CreateSessionRequest,
): Promise<CreateSessionResult> {
  const { tmux, projection, serverPort, settingsPath, readClaudeCommand, permissionMode } = deps;

  const panes = await tmux.listPanes();
  const takenNames = takenTmuxNames(projection, panes);
  const id = randomUUID();
  const tmuxName = deriveTmuxName(request.cwd, takenNames);
  const claudeCommand = readClaudeCommand();

  await tmux.newSession({
    name: tmuxName,
    cwd: request.cwd,
    port: serverPort,
    sessionId: id,
    command: [
      ...claudeCommand,
      '--session-id',
      id,
      ...permissionFlags(permissionMode),
      ...spawnFlags(request),
      '--settings',
      settingsPath,
    ],
  });

  projection.dispatch({ type: 'session-registered', id, tmuxName, cwd: request.cwd });

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
  const { tmux, projection, serverPort, settingsPath, readClaudeCommand, permissionMode } = deps;
  const session = findSession(projection, request.id);
  const claudeCommand = readClaudeCommand();
  const command = [
    ...claudeCommand,
    '--resume',
    request.id,
    ...permissionFlags(permissionMode),
    ...spawnFlags(request),
    '--settings',
    settingsPath,
  ];
  const panes = await tmux.listPanes();
  const priorName = session.tmuxName;

  let result: ResumeSessionResult;
  if (priorName !== null && panes.some((pane) => pane.session === priorName)) {
    await tmux.respawnPane({ name: priorName, command });
    projection.dispatch({
      type: 'session-registered',
      id: request.id,
      tmuxName: priorName,
      cwd: session.cwd,
    });
    result = { id: request.id, tmuxName: priorName };
  } else {
    const takenNames = takenTmuxNames(projection, panes, request.id);
    const tmuxName = deriveTmuxName(session.cwd, takenNames);
    await tmux.newSession({
      name: tmuxName,
      cwd: session.cwd,
      port: serverPort,
      sessionId: session.id,
      command,
    });
    projection.dispatch({ type: 'session-registered', id: request.id, tmuxName, cwd: session.cwd });
    result = { id: request.id, tmuxName };
  }

  unarchiveResumedSwarm(deps, request.id);
  return result;
}

/**
 * Kills the tmux session and unregisters its name, so the session reads `dead` with no tmux
 * name straight away rather than after the next tmux snapshot.
 */
export async function killSession(deps: SessionsDeps, request: KillSessionRequest): Promise<void> {
  const { tmux, projection } = deps;
  const session = findSession(projection, request.id);
  if (session.tmuxName !== null) await tmux.killSession(session.tmuxName);
  projection.dispatch({ type: 'session-unregistered', id: request.id });
}
