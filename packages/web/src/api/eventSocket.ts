import type { ServerMessage } from '@garden/shared';

export interface EventSocketHandlers {
  onSnapshot: (message: Extract<ServerMessage, { type: 'snapshot' }>) => void;
  onDeltas: (message: Extract<ServerMessage, { type: 'deltas' }>) => void;
  onUiState: (message: Extract<ServerMessage, { type: 'ui-state' }>) => void;
  /** Fires on every successful (re)connection, including the first. A dropped connection
   *  loses every pane attach with it, so this is what tells on-stage panes to reattach. */
  onConnect: () => void;
}

const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 10_000;

/** Doubles from `INITIAL_RECONNECT_DELAY_MS`, capped at `MAX_RECONNECT_DELAY_MS`. */
export function nextReconnectDelayMs(attempt: number): number {
  return Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
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
    socket.addEventListener('close', () => {
      if (stopped) return;
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
