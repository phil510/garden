import { Terminal } from '@xterm/xterm';
import { connectPaneSocket, type PaneSize } from '../api/paneSocket.js';

export interface PaneHandle {
  readonly terminal: Terminal;
  /** Moves the terminal's already-open DOM element into `container`. A no-op if it is
   *  already there. */
  mount(container: HTMLElement): void;
  resize(size: PaneSize): void;
  /** Ends the pane socket and disposes the terminal. There is no detach-and-keep-warm: a
   *  session with no container holding it has nothing rendering its bytes. */
  dispose(): void;
}

/** The one escape hatch (docs/architecture.md §5.1): xterm instances and their pane sockets
 *  outlive React's tree, keyed by session id, so a preset switch or maximise never remounts
 *  one and drops its socket. */
const panes = new Map<string, PaneHandle>();

function createPane(sessionId: string, container: HTMLElement, size: PaneSize): PaneHandle {
  const terminal = new Terminal();
  terminal.open(container);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    panes.delete(sessionId);
    socket.close();
    terminal.dispose();
  };

  const socket = connectPaneSocket(sessionId, size, {
    onData: (chunk) => terminal.write(chunk),
    onClose: dispose,
  });
  terminal.onData((data) => socket.write(data));

  return {
    terminal,
    mount(nextContainer) {
      if (terminal.element !== undefined && terminal.element.parentElement !== nextContainer) {
        nextContainer.appendChild(terminal.element);
      }
    },
    resize(nextSize) {
      terminal.resize(nextSize.cols, nextSize.rows);
      socket.resize(nextSize);
    },
    dispose,
  };
}

/** Returns the session's pane, moved into `container`. A session already in the registry is
 *  never attached a second time — the server refuses a second concurrent attach per session,
 *  so reusing the existing socket and moving its terminal is what keeps that refusal from
 *  ever being reached. */
export function attachPane(sessionId: string, container: HTMLElement, size: PaneSize): PaneHandle {
  const existing = panes.get(sessionId);
  if (existing !== undefined) {
    existing.mount(container);
    existing.resize(size);
    return existing;
  }
  const handle = createPane(sessionId, container, size);
  panes.set(sessionId, handle);
  return handle;
}

/** Ends a session's pane socket and disposes its terminal. Safe to call on a session with no
 *  open pane. */
export function detachPane(sessionId: string): void {
  panes.get(sessionId)?.dispose();
}
