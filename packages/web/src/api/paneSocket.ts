import type { PaneResizeMessage } from '@garden/shared';

export interface PaneSize {
  cols: number;
  rows: number;
}

export interface PaneSocketHandlers {
  onData: (chunk: string) => void;
  /** The pty exited, the server refused the attach, or the connection dropped. Whatever the
   *  cause, the socket is done — reattaching means opening a new one. */
  onClose: () => void;
}

export interface PaneSocket {
  write(data: string): void;
  resize(size: PaneSize): void;
  close(): void;
}

function paneUrl(sessionId: string, size: PaneSize): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/attach/${sessionId}?cols=${size.cols}&rows=${size.rows}`;
}

/** Opens `WS /attach/:id`. Bytes are binary frames both ways; resize is a JSON text frame.
 *  The initial size travels in the connect URL, so only a later resize needs the frame. */
export function connectPaneSocket(
  sessionId: string,
  size: PaneSize,
  handlers: PaneSocketHandlers,
): PaneSocket {
  const socket = new WebSocket(paneUrl(sessionId, size));
  socket.binaryType = 'arraybuffer';

  // A key pressed while the handshake is still in flight would otherwise be lost.
  const pendingWrites: string[] = [];
  socket.addEventListener('open', () => {
    for (const data of pendingWrites.splice(0)) socket.send(new TextEncoder().encode(data));
  });
  socket.addEventListener('message', (event) => {
    handlers.onData(new TextDecoder().decode(event.data as ArrayBuffer));
  });
  socket.addEventListener('close', () => handlers.onClose());

  return {
    write(data) {
      if (socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
      else if (socket.readyState === WebSocket.CONNECTING) pendingWrites.push(data);
    },
    resize(nextSize) {
      if (socket.readyState !== WebSocket.OPEN) return;
      const message: PaneResizeMessage = {
        type: 'resize',
        cols: nextSize.cols,
        rows: nextSize.rows,
      };
      socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    },
  };
}
