import {
  killSession,
  listPanes,
  newSession,
  respawnPane,
  type TmuxTarget,
} from '../../../packages/server/src/adapters/tmux.js';
import type { TmuxPort } from '../../../packages/server/src/app/ports.js';

/** The real tmux adapter bound to a test's isolated tmux server. */
export function tmuxPort(target: TmuxTarget): TmuxPort {
  return {
    listPanes: () => listPanes(target),
    newSession: (request) => newSession(target, request),
    respawnPane: (request) => respawnPane(target, request),
    killSession: (name) => killSession(target, name),
  };
}
