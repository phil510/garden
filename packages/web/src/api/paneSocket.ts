import { PANE_CLOSE_CODES, type PaneResizeMessage } from '@garden/shared';
import { nextReconnectDelayMs } from './eventSocket.js';

export interface PaneSize {
  cols: number;
  rows: number;
}

export interface PaneSocketHandlers {
  onData: (chunk: string) => void;
  /** The attach is over for good — the pty exited, or the server refused for a reason another
   *  attempt cannot change. Reattaching means opening a new socket. Transient closes never
   *  reach here; those reconnect underneath. */
  onClose: (code: number) => void;
}

export interface PaneSocket {
  write(data: string): void;
  resize(size: PaneSize): void;
  close(): void;
}

export type PaneCloseDisposition = 'reconnect' | 'dispose';

/** This is client retry policy, not part of the wire contract in `@garden/shared` — it decides
 *  which of the server's close codes are worth a reconnect attempt, which only the client cares
 *  about.
 *
 *  A wrong connect URL (4000), a session that does not exist (4004) or one that is not running
 *  (4001) all describe a state no retry moves, and PTY_EXITED (1000) is the pty having exited.
 *  The server's other two refusals do move: 4009 is a previous attach the server has not
 *  finished releasing, and 4500 is an attach that failed for an unstated reason. Any code beyond
 *  those is the connection dropping rather than the server deciding anything, which is the most
 *  transient case of all. */
export function paneCloseDisposition(code: number): PaneCloseDisposition {
  switch (code) {
    case PANE_CLOSE_CODES.PTY_EXITED:
    case PANE_CLOSE_CODES.BAD_REQUEST:
    case PANE_CLOSE_CODES.SESSION_NOT_RUNNING:
    case PANE_CLOSE_CODES.SESSION_NOT_FOUND:
      return 'dispose';
    default:
      return 'reconnect';
  }
}

function paneUrl(sessionId: string, size: PaneSize): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/attach/${sessionId}?cols=${size.cols}&rows=${size.rows}`;
}

/** Opens `WS /attach/:id`. Bytes are binary frames both ways; resize is a JSON text frame.
 *  The initial size travels in the connect URL, so only a later resize needs the frame.
 *
 *  A close the server has not attributed to a settled state reconnects with backoff, at the
 *  size the pane is now rather than the size it was opened at. */
export function connectPaneSocket(
  sessionId: string,
  size: PaneSize,
  handlers: PaneSocketHandlers,
): PaneSocket {
  // A key pressed while a handshake is still in flight would otherwise be lost.
  const pendingWrites: string[] = [];
  let currentSize = size;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function send(data: string): void {
    socket?.send(new TextEncoder().encode(data));
  }

  function connect(): void {
    socket = new WebSocket(paneUrl(sessionId, currentSize));
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      attempt = 0;
      for (const data of pendingWrites.splice(0)) send(data);
    });
    socket.addEventListener('message', (event) => {
      handlers.onData(new TextDecoder().decode(event.data as ArrayBuffer));
    });
    socket.addEventListener('close', (event) => {
      if (stopped) return;
      if (paneCloseDisposition(event.code) === 'dispose') {
        stopped = true;
        handlers.onClose(event.code);
        return;
      }
      reconnectTimer = setTimeout(connect, nextReconnectDelayMs(attempt));
      attempt += 1;
    });
  }

  connect();

  return {
    write(data) {
      if (socket?.readyState === WebSocket.OPEN) send(data);
      else if (socket?.readyState === WebSocket.CONNECTING) pendingWrites.push(data);
    },
    resize(nextSize) {
      currentSize = nextSize;
      if (socket?.readyState !== WebSocket.OPEN) return;
      const message: PaneResizeMessage = {
        type: 'resize',
        cols: nextSize.cols,
        rows: nextSize.rows,
      };
      socket.send(JSON.stringify(message));
    },
    close() {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
