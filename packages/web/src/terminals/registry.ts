import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { connectPaneSocket, type PaneSize } from '../api/paneSocket.js';
import { useLocalStore } from '../state/localStore.js';
import { findPathLineLinks } from './pathLineLinks.js';
import { terminalTheme } from './theme.js';

export interface PaneHandle {
  readonly terminal: Terminal;
  /** Moves the terminal's already-open DOM element into `container`, a no-op if it is already
   *  there, and fits it to the container's current size. */
  mount(container: HTMLElement): void;
  /** Ends the pane socket and disposes the terminal. There is no detach-and-keep-warm: a
   *  session with no container holding it has nothing rendering its bytes. */
  dispose(): void;
}

/** The one escape hatch (docs/architecture.md §5.1): xterm instances and their pane sockets
 *  outlive React's tree, keyed by session id, so a preset switch or maximise never remounts
 *  one and drops its socket. */
const panes = new Map<string, PaneHandle>();

const FALLBACK_SIZE: PaneSize = { cols: 80, rows: 24 };

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** xterm decodes tmux's mouse-tracking escape sequences on its own once tmux's `mouse on`
 *  requests them, and forwards the resulting reports back through the same `onData` stream a
 *  keypress would use — there is nothing beyond a normally-configured terminal to wire up for
 *  CC's wheel scrolling to work. */
function createPane(sessionId: string, container: HTMLElement): PaneHandle {
  const terminal = new Terminal({ theme: terminalTheme(readCssVar) });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  terminal.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (line === undefined) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const links = findPathLineLinks(text).map((link) => ({
        text: `${link.path}:${String(link.line)}`,
        range: {
          start: { x: link.index + 1, y: bufferLineNumber },
          end: { x: link.index + link.length + 1, y: bufferLineNumber },
        },
        activate: () => {
          useLocalStore.getState().requestOpenFile(sessionId, link.path, link.line);
        },
      }));
      callback(links.length > 0 ? links : undefined);
    },
  });

  const initialSize = fitAddon.proposeDimensions() ?? FALLBACK_SIZE;
  terminal.resize(initialSize.cols, initialSize.rows);

  let disposed = false;
  let resizeObserver: ResizeObserver | undefined;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect();
    panes.delete(sessionId);
    socket.close();
    terminal.dispose();
  };

  const socket = connectPaneSocket(sessionId, initialSize, {
    onData: (chunk) => terminal.write(chunk),
    onClose: dispose,
  });
  terminal.onData((data) => socket.write(data));

  function fit(): void {
    const dims = fitAddon.proposeDimensions();
    if (dims === undefined) return;
    terminal.resize(dims.cols, dims.rows);
    socket.resize(dims);
  }

  return {
    terminal,
    mount(nextContainer) {
      if (terminal.element !== undefined && terminal.element.parentElement !== nextContainer) {
        nextContainer.appendChild(terminal.element);
      }
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(fit);
      resizeObserver.observe(nextContainer);
      fit();
    },
    dispose,
  };
}

/** Returns the session's pane, moved into `container` and fitted to it. A session already in
 *  the registry is never attached a second time — the server refuses a second concurrent attach
 *  per session, so reusing the existing socket and moving its terminal is what keeps that
 *  refusal from ever being reached. */
export function attachPane(sessionId: string, container: HTMLElement): PaneHandle {
  const existing = panes.get(sessionId);
  if (existing !== undefined) {
    existing.mount(container);
    return existing;
  }
  const handle = createPane(sessionId, container);
  panes.set(sessionId, handle);
  return handle;
}

/** Ends a session's pane socket and disposes its terminal. Safe to call on a session with no
 *  open pane. */
export function detachPane(sessionId: string): void {
  panes.get(sessionId)?.dispose();
}
