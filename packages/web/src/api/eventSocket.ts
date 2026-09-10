import { EVENTS_CLOSE_CODES, type ServerMessage } from '@garden/shared';

export interface EventSocketHandlers {
  onSnapshot: (message: Extract<ServerMessage, { type: 'snapshot' }>) => void;
  onDeltas: (message: Extract<ServerMessage, { type: 'deltas' }>) => void;
  onUiState: (message: Extract<ServerMessage, { type: 'ui-state' }>) => void;
  /** Fires on every successful (re)connection, including the first. A dropped connection
   *  loses every pane attach with it, so this is what tells on-stage panes to reattach. */
  onConnect: () => void;
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

/** Connects `WS /events` and dispatches messages to `handlers`, reconnecting with backoff
 *  after every drop. Returns a function that closes the socket and stops reconnecting. */
export function connectEventSocket(handlers: EventSocketHandlers): () => void {
  let attempt = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function connect() {
    socket = new WebSocket(eventsUrl());
    socket.addEventListener('open', () => {
      attempt = 0;
      handlers.onConnect();
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === 'snapshot') handlers.onSnapshot(message);
      else if (message.type === 'deltas') handlers.onDeltas(message);
      else handlers.onUiState(message);
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

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    socket?.close();
  };
}
