import { PANE_CLOSE_CODES, type PaneResizeMessage } from '@garden/shared';
import { connectReconnectingSocket, socketUrl } from './reconnectingSocket.js';

export interface PaneSize {
  cols: number;
  rows: number;
}

export interface PaneSocketHandlers {
  onData: (chunk: string) => void;
  /** The attach is over — the pty exited, the server refused for a reason another attempt cannot
   *  change, or an `ALREADY_ATTACHED` refusal outlasted its retries. Reattaching means opening a
   *  new socket. Transient closes never reach here; those reconnect underneath. */
  onClose: (code: number) => void;
}

export interface PaneSocket {
  write(data: string): void;
  resize(size: PaneSize): void;
  close(): void;
}

export type PaneCloseDisposition = 'reconnect' | 'dispose';

/** How many times a refused attach (4009) is retried before the pane gives up. */
const MAX_REFUSED_ATTACH_RETRIES = 2;

/** This is client retry policy, not part of the wire contract in `@garden/shared` — it decides
 *  which of the server's close codes are worth a reconnect attempt, which only the client cares
 *  about.
 *
 *  A wrong connect URL (4000), a session that does not exist (4004) or one that is not running
 *  (4001) all describe a state no retry moves, and PTY_EXITED (1000) is the pty having exited.
 *  4009 means the session is attached somewhere else. That is transient only when the holder is
 *  our own previous socket, which the server has not yet noticed closed, and persistent when
 *  another window holds it. The close frame cannot tell the two apart, so a few retries do:
 *  `consecutiveRefusals` counts the 4009s in a row, this one included, and the pane stops once
 *  they exceed the budget. 4500 is an attach that failed for an unstated reason, and any code
 *  beyond those is the connection dropping rather than the server deciding anything, the most
 *  transient case of all. */
export function paneCloseDisposition(
  code: number,
  consecutiveRefusals: number,
): PaneCloseDisposition {
  switch (code) {
    case PANE_CLOSE_CODES.PTY_EXITED:
    case PANE_CLOSE_CODES.BAD_REQUEST:
    case PANE_CLOSE_CODES.SESSION_NOT_RUNNING:
    case PANE_CLOSE_CODES.SESSION_NOT_FOUND:
      return 'dispose';
    case PANE_CLOSE_CODES.ALREADY_ATTACHED:
      return consecutiveRefusals <= MAX_REFUSED_ATTACH_RETRIES ? 'reconnect' : 'dispose';
    default:
      return 'reconnect';
  }
}

function paneUrl(sessionId: string, size: PaneSize): string {
  return socketUrl(`/attach/${sessionId}?cols=${size.cols}&rows=${size.rows}`);
}

/** Opens `WS /attach/:id`. Bytes are binary frames both ways; resize is a JSON text frame.
 *  The initial size travels in the connect URL, so only a later resize needs the frame.
 *
 *  A close the server has not attributed to a settled state reconnects with backoff, at the
 *  size the pane is now rather than the size it was opened at. A refused attach is retried a
 *  bounded number of times; see `paneCloseDisposition`. */
export function connectPaneSocket(
  sessionId: string,
  size: PaneSize,
  handlers: PaneSocketHandlers,
): PaneSocket {
  // A key pressed while a handshake is still in flight would otherwise be lost.
  const pendingWrites: string[] = [];
  let currentSize = size;
  // An attached socket never closes with 4009, so a run of them ends at the first other close.
  let consecutiveRefusals = 0;

  function send(data: string): void {
    connection.current()?.send(new TextEncoder().encode(data));
  }

  const connection = connectReconnectingSocket({
    url: () => paneUrl(sessionId, currentSize),
    setup: (socket) => {
      socket.binaryType = 'arraybuffer';
      // Streaming mode carries a multi-byte character's leading bytes across frame boundaries;
      // a fresh decoder per message would emit U+FFFD for the half it can't yet decode.
      const decoder = new TextDecoder();

      socket.addEventListener('open', () => {
        for (const data of pendingWrites.splice(0)) send(data);
      });
      socket.addEventListener('message', (event) => {
        handlers.onData(decoder.decode(event.data as ArrayBuffer, { stream: true }));
      });
    },
    onClose: (code) => {
      consecutiveRefusals =
        code === PANE_CLOSE_CODES.ALREADY_ATTACHED ? consecutiveRefusals + 1 : 0;
      if (paneCloseDisposition(code, consecutiveRefusals) === 'reconnect') return 'reconnect';
      handlers.onClose(code);
      return 'stop';
    },
  });

  return {
    write(data) {
      const socket = connection.current();
      if (socket?.readyState === WebSocket.OPEN) send(data);
      else if (socket?.readyState === WebSocket.CONNECTING) pendingWrites.push(data);
    },
    resize(nextSize) {
      currentSize = nextSize;
      const socket = connection.current();
      if (socket?.readyState !== WebSocket.OPEN) return;
      const message: PaneResizeMessage = {
        type: 'resize',
        cols: nextSize.cols,
        rows: nextSize.rows,
      };
      socket.send(JSON.stringify(message));
    },
    close: connection.close,
  };
}
