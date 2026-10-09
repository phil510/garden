const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 10_000;

/** Doubles from `INITIAL_RECONNECT_DELAY_MS`, capped at `MAX_RECONNECT_DELAY_MS`. */
export function nextReconnectDelayMs(attempt: number): number {
  return Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
}

/** A `ws:` or `wss:` URL on this page's host, matching the page's own protocol. */
export function socketUrl(path: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${path}`;
}

export interface ReconnectingSocketOptions {
  /** Evaluated on every connect, so a reconnect can differ from the first attempt. */
  url: () => string;
  /** Runs on each new socket. The caller sets `binaryType` and adds its own listeners here;
   *  state that belongs to one connection lives in this closure. */
  setup: (socket: WebSocket) => void;
  /** Decides what a close means. Not called once `close()` has run. */
  onClose: (code: number) => 'reconnect' | 'stop';
}

export interface ReconnectingSocket {
  /** The live socket, which changes on every reconnect. */
  current: () => WebSocket | null;
  /** Closes the socket and stops reconnecting. */
  close: () => void;
}

/** Owns a socket's connect, backoff, and stop lifecycle. The backoff resets once a connection
 *  opens, so only consecutive failures grow the delay. */
export function connectReconnectingSocket(options: ReconnectingSocketOptions): ReconnectingSocket {
  let socket: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function connect(): void {
    const next = new WebSocket(options.url());
    socket = next;
    next.addEventListener('open', () => {
      attempt = 0;
    });
    options.setup(next);
    next.addEventListener('close', (event) => {
      if (stopped) return;
      if (options.onClose(event.code) === 'stop') {
        stopped = true;
        return;
      }
      reconnectTimer = setTimeout(connect, nextReconnectDelayMs(attempt));
      attempt += 1;
    });
  }

  connect();

  return {
    current: () => socket,
    close: () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
