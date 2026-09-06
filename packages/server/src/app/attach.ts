import type { PaneSize, PtyPort } from './ports.js';
import type { Projection } from './projection.js';
import { SessionNotFoundError } from './sessions.js';

export interface AttachDeps {
  readonly pty: PtyPort;
  readonly projection: Projection;
}

export interface AttachRequest {
  readonly id: string;
  readonly size: PaneSize;
  readonly onData: (chunk: string) => void;
  readonly onExit: () => void;
}

export interface Attachment {
  write(data: string): void;
  resize(size: PaneSize): void;
  /** Detaches. Safe to call after the pty has already exited on its own. */
  close(): void;
}

export interface AttachRegistry {
  attach(request: AttachRequest): Attachment;
}

/** A second pane socket for a session garden is already streaming. The caller
 *  distinguishes this from every other failure so the client can move the pane it has. */
export class SessionAlreadyAttachedError extends Error {}

/** A session tmux no longer holds has nothing to attach to; it has to be resumed first. */
export class SessionNotRunningError extends Error {}

/**
 * The one-attach-per-session rule and the bookkeeping behind it. This is not session
 * state: nothing outside the attach path reads it, and it never reaches the client —
 * `shown` is what tells the client a session is already on stage.
 */
export function createAttachRegistry(deps: AttachDeps): AttachRegistry {
  const open = new Set<string>();

  return {
    attach(request) {
      const session = deps.projection.sessions().find((candidate) => candidate.id === request.id);
      if (session === undefined) throw new SessionNotFoundError(`no such session: ${request.id}`);
      if (session.tmuxName === null)
        throw new SessionNotRunningError(`session has no tmux session: ${request.id}`);
      if (open.has(request.id))
        throw new SessionAlreadyAttachedError(`session is already attached: ${request.id}`);

      open.add(request.id);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        open.delete(request.id);
      };

      const attachment = deps.pty.attach(session.tmuxName, request.size, {
        onData: request.onData,
        onExit: () => {
          release();
          request.onExit();
        },
      });

      return {
        write: (data) => attachment.write(data),
        resize: (size) => attachment.resize(size),
        close: () => {
          // Freeing the slot before the kill means a client that closes and immediately
          // reopens is not refused by its own previous attach still winding down.
          release();
          attachment.kill();
        },
      };
    },
  };
}
