import { EVENTS_CLOSE_CODES, type EventsClientMessage, type ServerMessage } from '@garden/shared';
import { connectReconnectingSocket, socketUrl } from './reconnectingSocket.js';

export interface EventSocketHandlers {
  onSnapshot: (message: Extract<ServerMessage, { type: 'snapshot' }>) => void;
  onDeltas: (message: Extract<ServerMessage, { type: 'deltas' }>) => void;
  onUiState: (message: Extract<ServerMessage, { type: 'ui-state' }>) => void;
  /** Fires on every successful (re)connection, including the first. A dropped connection
   *  loses every pane attach with it, so this is what tells on-stage panes to reattach. */
  onConnect: () => void;
  /** A watched root changed on disk. `root` echoes the spelling `watch` sent. */
  onFsChanged: (root: string) => void;
  /** The server is stopping deliberately. Reconnecting would only spin forever, so this is
   *  the app's cue to render a terminal state instead. */
  onShutdown?: () => void;
}

export type EventCloseDisposition = 'reconnect' | 'terminal';

/** This is client behavior, not part of the wire contract in `@garden/shared` — it decides
 *  whether a close is the server telling the client to stop trying, or just a connection drop
 *  worth reconnecting from. Every code but the deliberate-shutdown one reconnects, including a
 *  plain dropped connection, which has no code from the app's perspective. */
export function eventCloseDisposition(code: number): EventCloseDisposition {
  return code === EVENTS_CLOSE_CODES.DELIBERATE_SHUTDOWN ? 'terminal' : 'reconnect';
}

export interface EventSocketController {
  /** Closes the socket and stops reconnecting. */
  stop: () => void;
  /** Remembers the root to watch and sends it when the socket is open. The server drops a watch
   *  with its connection, so the remembered root is re-sent on every reconnect. `null` forgets
   *  it; the server keeps the old watch until the connection ends or another root replaces it. */
  watch: (root: string | null) => void;
}

/** Connects `WS /events` and dispatches messages to `handlers`, reconnecting with backoff
 *  after every drop. */
export function connectEventSocket(handlers: EventSocketHandlers): EventSocketController {
  let watchedRoot: string | null = null;

  function sendWatch() {
    const socket = connection.current();
    if (watchedRoot === null || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'watch', root: watchedRoot } satisfies EventsClientMessage));
  }

  function dispatch(data: unknown) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data as string);
    } catch {
      console.warn('garden: dropped malformed event frame', data);
      return;
    }
    // Only `type` is checked, not the payload behind it: the server is trusted, and this guards
    // against a frame that is not a message at all.
    const message =
      typeof parsed === 'object' && parsed !== null ? (parsed as ServerMessage) : null;
    switch (message?.type) {
      case 'snapshot':
        return handlers.onSnapshot(message);
      case 'deltas':
        return handlers.onDeltas(message);
      case 'ui-state':
        return handlers.onUiState(message);
      case 'fs-changed':
        return handlers.onFsChanged(message.root);
      default:
        console.warn('garden: dropped malformed event frame', data);
    }
  }

  const connection = connectReconnectingSocket({
    url: () => socketUrl('/events'),
    setup: (socket) => {
      socket.addEventListener('open', () => {
        sendWatch();
        handlers.onConnect();
      });
      socket.addEventListener('message', (event) => dispatch(event.data));
    },
    onClose: (code) => {
      if (eventCloseDisposition(code) === 'reconnect') return 'reconnect';
      handlers.onShutdown?.();
      return 'stop';
    },
  });

  return {
    stop: connection.close,
    watch: (root) => {
      watchedRoot = root;
      sendWatch();
    },
  };
}
