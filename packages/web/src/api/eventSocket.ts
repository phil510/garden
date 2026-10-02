import { EVENTS_CLOSE_CODES, type EventsClientMessage, type ServerMessage } from '@garden/shared';

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

const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 10_000;

/** Doubles from `INITIAL_RECONNECT_DELAY_MS`, capped at `MAX_RECONNECT_DELAY_MS`. */
export function nextReconnectDelayMs(attempt: number): number {
  return Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
}

export type EventCloseDisposition = 'reconnect' | 'terminal';

/** This is client behavior, not part of the wire contract in `@garden/shared` — it decides
 *  whether a close is the server telling the client to stop trying, or just a connection drop
 *  worth reconnecting from. Every code but the deliberate-shutdown one reconnects, including a
 *  plain dropped connection, which has no code from the app's perspective. */
export function eventCloseDisposition(code: number): EventCloseDisposition {
  return code === EVENTS_CLOSE_CODES.DELIBERATE_SHUTDOWN ? 'terminal' : 'reconnect';
}

function eventsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/events`;
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
  let attempt = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let watchedRoot: string | null = null;

  function sendWatch() {
    if (watchedRoot === null || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'watch', root: watchedRoot } satisfies EventsClientMessage));
  }

  function connect() {
    socket = new WebSocket(eventsUrl());
    socket.addEventListener('open', () => {
      attempt = 0;
      sendWatch();
      handlers.onConnect();
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === 'snapshot') handlers.onSnapshot(message);
      else if (message.type === 'deltas') handlers.onDeltas(message);
      else if (message.type === 'ui-state') handlers.onUiState(message);
      else handlers.onFsChanged(message.root);
    });
    socket.addEventListener('close', (event) => {
      if (stopped) return;
      if (eventCloseDisposition(event.code) === 'terminal') {
        stopped = true;
        handlers.onShutdown?.();
        return;
      }
      reconnectTimer = setTimeout(connect, nextReconnectDelayMs(attempt));
      attempt += 1;
    });
  }

  connect();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
    watch: (root) => {
      watchedRoot = root;
      sendWatch();
    },
  };
}
