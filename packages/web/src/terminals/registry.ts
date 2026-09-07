import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { connectPaneSocket, type PaneSize } from '../api/paneSocket.js';
import { useLocalStore } from '../state/localStore.js';
import { findPathLineLinks } from './pathLineLinks.js';
import { terminalTheme } from './theme.js';

interface PaneHandle {
  /** The event-socket connection this pane's attach belongs to. The server tracks pane attaches
   *  independently of that socket, so this is a deliberately conservative policy: a pane from an
   *  earlier epoch is treated as scrap and rebuilt rather than trusted. */
  readonly epoch: number;
  /** Moves the terminal's already-open DOM element into `container`, a no-op if it is already
   *  there, then fits it to that container and tracks its size from then on. */
  mount(container: HTMLElement): void;
  /** Ends the pane socket and disposes the terminal. A pane survives a React remount, but never
   *  the loss of its panel or of its session's liveness. */
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

/** Whether the container has been laid out at all, read the way the fit addon reads it. */
function hasSize(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return parseFloat(style.width) > 0 && parseFloat(style.height) > 0;
}

/** xterm decodes tmux's mouse-tracking escape sequences on its own once tmux's `mouse on`
 *  requests them, and forwards the resulting reports back through the same `onData` stream a
 *  keypress would use — there is nothing beyond a normally-configured terminal to wire up for
 *  CC's wheel scrolling to work. */
function createPane(sessionId: string, container: HTMLElement, epoch: number): PaneHandle {
  const terminal = new Terminal({ fontSize: 13, theme: terminalTheme(readCssVar) });
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

  // `proposeDimensions` reports "no size to fit to" in two ways for a pane that is hidden or not
  // laid out yet: NaN, or its own clamped minimum. Either would size the pty to garbage, so
  // neither counts as a proposal.
  function proposeSize(): PaneSize | undefined {
    const host = terminal.element?.parentElement;
    if (host === null || host === undefined || !hasSize(host)) return undefined;
    const dims = fitAddon.proposeDimensions();
    if (dims === undefined || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) {
      return undefined;
    }
    return dims;
  }

  const initialSize = proposeSize() ?? FALLBACK_SIZE;
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
    const dims = proposeSize();
    if (dims === undefined) return;
    terminal.resize(dims.cols, dims.rows);
    socket.resize(dims);
  }

  return {
    epoch,
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

/** Puts the session's pane in `container`, fitted to it and tracking its size. A session already
 *  in the registry is never attached a second time — the server refuses a second concurrent
 *  attach per session, so moving the existing terminal and reusing its socket is what keeps that
 *  refusal from ever being reached. A pane held over from an earlier `epoch` is the one case
 *  where that socket is already gone, so it is replaced rather than reused. */
export function attachPane(sessionId: string, container: HTMLElement, epoch: number): void {
  const existing = panes.get(sessionId);
  if (existing !== undefined && existing.epoch === epoch) {
    existing.mount(container);
    return;
  }
  existing?.dispose();
  const handle = createPane(sessionId, container, epoch);
  panes.set(sessionId, handle);
  handle.mount(container);
}

/** Ends a session's pane socket and disposes its terminal. Safe to call on a session with no
 *  open pane. */
export function detachPane(sessionId: string): void {
  panes.get(sessionId)?.dispose();
}
