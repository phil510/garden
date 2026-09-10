import type { SessionMap, SessionState } from '@garden/shared';
import { deriveLiveness } from './sessions.js';
import { hookOutcome } from './status.js';
import type { GardenEvent, GardenState, TmuxSessionFact } from './types.js';

export const initialState: GardenState = {
  sessions: {},
  tmuxNames: {},
  tmux: {},
  repoInfo: {},
  ended: {},
  reported: {},
};

function blank(id: string): SessionState {
  return {
    id,
    cwd: '',
    repoRoot: null,
    worktree: null,
    branch: null,
    title: null,
    recap: null,
    liveness: 'dead',
    status: null,
    statusReason: null,
    exitCode: null,
    tmuxName: null,
    lastActivity: 0,
  };
}

/** Projects the raw tmux, hook and repo-root facts onto every session, so the order events
 *  arrive in cannot change the outcome. */
function rederive(state: GardenState): GardenState {
  const sessions: SessionMap = {};
  for (const [id, session] of Object.entries(state.sessions)) {
    const tmuxName = state.tmuxNames[id] ?? null;
    const fact = tmuxName === null ? undefined : state.tmux[tmuxName];
    const { liveness, exitCode } = deriveLiveness({ fact, ended: state.ended[id] === true });
    const dead = liveness === 'dead';
    const reported = state.reported[id];
    sessions[id] = {
      ...session,
      tmuxName,
      // Null covers both a cwd nothing has resolved yet and one that is not in a repo.
      repoRoot: state.repoInfo[session.cwd]?.repoRoot ?? null,
      // Null covers both a cwd nothing has resolved yet and one whose tree is the main checkout.
      worktree: state.repoInfo[session.cwd]?.worktree ?? null,
      liveness,
      exitCode,
      // Status belongs to live sessions: none yet heard from reads `unknown`, dead reads nothing.
      status: dead ? null : (reported?.status ?? 'unknown'),
      statusReason: dead ? null : (reported?.reason ?? null),
    };
  }
  return { ...state, sessions };
}

export function reduce(state: GardenState, event: GardenEvent): GardenState {
  switch (event.type) {
    case 'store-loaded':
      return rederive({ ...state, tmuxNames: { ...state.tmuxNames, ...event.tmuxNames } });
    case 'session-registered': {
      const prev = state.sessions[event.id] ?? blank(event.id);
      return rederive({
        ...state,
        tmuxNames: { ...state.tmuxNames, [event.id]: event.tmuxName },
        sessions: { ...state.sessions, [event.id]: { ...prev, cwd: event.cwd } },
        // Registering means a process was just started under this id, whether by create or
        // by resume. Whatever ended the previous run no longer describes the session.
        ended: { ...state.ended, [event.id]: false },
      });
    }
    case 'transcript-changed': {
      const { record } = event;
      const id = record.sessionId;
      if (id === null) return state;
      const prev = state.sessions[id] ?? blank(id);
      const session: SessionState = {
        ...prev,
        cwd: record.cwd ?? prev.cwd,
        branch: record.gitBranch ?? prev.branch,
        title: record.title ?? record.lastPrompt ?? prev.title,
        recap: record.recap ?? prev.recap,
        // A transcript with no timestamped line reports no activity, so the previous stands.
        lastActivity: Math.max(prev.lastActivity, record.lastActivity ?? 0),
      };
      return rederive({ ...state, sessions: { ...state.sessions, [id]: session } });
    }
    case 'repo-info-resolved':
      return rederive({
        ...state,
        repoInfo: {
          ...state.repoInfo,
          [event.cwd]: { repoRoot: event.repoRoot, worktree: event.worktree },
        },
      });
    case 'hook': {
      const id = event.payload.session_id;
      if (id === '') return state;
      const prev = state.sessions[id] ?? blank(id);
      const outcome = hookOutcome(event.payload);
      const session: SessionState = {
        ...prev,
        cwd: prev.cwd === '' ? event.payload.cwd : prev.cwd,
      };
      return rederive({
        ...state,
        sessions: { ...state.sessions, [id]: session },
        ended: outcome.ended === null ? state.ended : { ...state.ended, [id]: outcome.ended },
        reported:
          outcome.status === null
            ? state.reported
            : { ...state.reported, [id]: { status: outcome.status, reason: outcome.reason } },
      });
    }
    case 'tmux-snapshot': {
      const tmux: Record<string, TmuxSessionFact> = {};
      for (const fact of event.sessions) tmux[fact.name] = fact;
      return rederive({ ...state, tmux });
    }
  }
  // No default arm: a switch without one narrows to never here, so a new event
  // variant fails to compile rather than being silently swallowed.
  event satisfies never;
  return state;
}
