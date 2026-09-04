import type { SessionMap, SessionState } from '@garden/shared';
import { deriveLiveness } from './sessions.js';
import { hookOutcome } from './status.js';
import type { GardenEvent, GardenState, TmuxSessionFact } from './types.js';

export const initialState: GardenState = {
  sessions: {},
  tmuxNames: {},
  tmux: {},
  ended: {},
  lastEventAt: 0,
};

function blank(id: string): SessionState {
  return {
    id,
    cwd: '',
    repoRoot: null,
    branch: null,
    title: null,
    recap: null,
    liveness: 'dead',
    status: 'unknown',
    statusReason: null,
    exitCode: null,
    tmuxName: null,
    attached: false,
    lastActivity: 0,
  };
}

/** Re-derives every session's tmux-dependent and time-dependent fields, so the order events
 *  arrive in cannot change the outcome. */
function rederive(state: GardenState, at: number): GardenState {
  const sessions: SessionMap = {};
  for (const [id, session] of Object.entries(state.sessions)) {
    const tmuxName = state.tmuxNames[id] ?? null;
    const fact = tmuxName === null ? undefined : state.tmux[tmuxName];
    const { liveness, exitCode } = deriveLiveness({
      tmuxName,
      fact,
      ended: state.ended[id] === true,
      lastActivity: session.lastActivity,
      at,
    });
    const gone = liveness === 'exited' || liveness === 'dead';
    sessions[id] = {
      ...session,
      tmuxName,
      attached: fact?.attached ?? false,
      liveness,
      exitCode,
      status: gone ? 'unknown' : session.status,
      statusReason: gone ? null : session.statusReason,
    };
  }
  return { ...state, sessions };
}

export function reduce(state: GardenState, event: GardenEvent): GardenState {
  const at = Math.max(state.lastEventAt, event.at);
  switch (event.type) {
    case 'store-loaded':
      return rederive(
        { ...state, tmuxNames: { ...state.tmuxNames, ...event.tmuxNames }, lastEventAt: at },
        at,
      );
    case 'session-registered': {
      const prev = state.sessions[event.id] ?? blank(event.id);
      return rederive(
        {
          ...state,
          tmuxNames: { ...state.tmuxNames, [event.id]: event.tmuxName },
          sessions: { ...state.sessions, [event.id]: { ...prev, cwd: event.cwd } },
          lastEventAt: at,
        },
        at,
      );
    }
    case 'transcript-changed': {
      const { record } = event;
      const id = record.sessionId;
      if (id === null) return { ...state, lastEventAt: at };
      const prev = state.sessions[id] ?? blank(id);
      const session: SessionState = {
        ...prev,
        cwd: record.cwd ?? prev.cwd,
        branch: record.gitBranch ?? prev.branch,
        title: record.title ?? record.lastPrompt ?? prev.title,
        recap: record.recap ?? prev.recap,
        lastActivity: Math.max(prev.lastActivity, event.mtime),
      };
      return rederive(
        { ...state, sessions: { ...state.sessions, [id]: session }, lastEventAt: at },
        at,
      );
    }
    case 'hook': {
      const id = event.payload.session_id;
      if (id === '') return { ...state, lastEventAt: at };
      const prev = state.sessions[id] ?? blank(id);
      const outcome = hookOutcome(event.payload);
      const session: SessionState = {
        ...prev,
        cwd: prev.cwd === '' ? event.payload.cwd : prev.cwd,
        status: outcome.status ?? prev.status,
        statusReason: outcome.status === null ? prev.statusReason : outcome.reason,
        recap: outcome.recap ?? prev.recap,
        lastActivity: Math.max(prev.lastActivity, event.at),
      };
      return rederive(
        {
          ...state,
          sessions: { ...state.sessions, [id]: session },
          ended: outcome.ended === null ? state.ended : { ...state.ended, [id]: outcome.ended },
          lastEventAt: at,
        },
        at,
      );
    }
    case 'tmux-snapshot': {
      const tmux: Record<string, TmuxSessionFact> = {};
      for (const fact of event.sessions) tmux[fact.name] = fact;
      return rederive({ ...state, tmux, lastEventAt: at }, at);
    }
    case 'tick':
      return rederive({ ...state, lastEventAt: at }, at);
  }
  // No default arm: a switch without one narrows to never here, so a new event
  // variant fails to compile rather than being silently swallowed.
  event satisfies never;
  return state;
}
