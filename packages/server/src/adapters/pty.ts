import { spawn, type IPty } from 'node-pty';

/** Which tmux server to attach to. Passed in; the adapter never reads config itself. */
export interface PtyTarget {
  readonly socket: string;
  readonly confPath: string;
}

export interface PtySize {
  readonly cols: number;
  readonly rows: number;
}

export interface AttachHandlers {
  readonly onData: (chunk: string) => void;
  readonly onExit: () => void;
}

export interface PtyAttachment {
  write(data: string): void;
  resize(size: PtySize): void;
  kill(): void;
}

/** What the tmux client inside the pty is told it is talking to. The browser end is
 *  xterm.js, and tmux picks its own `default-terminal` for the shells it hosts. */
const TERM = 'xterm-256color';

/**
 * Attaches to an existing tmux session in a pty of its own. Killing the pty detaches
 * that client and leaves the tmux session — and the process inside it — running.
 */
export function attachPty(
  target: PtyTarget,
  name: string,
  size: PtySize,
  handlers: AttachHandlers,
): PtyAttachment {
  const pty: IPty = spawn(
    'tmux',
    ['-L', target.socket, '-f', target.confPath, 'attach', '-t', name],
    {
      name: TERM,
      cols: size.cols,
      rows: size.rows,
      env: { ...process.env, TERM },
    },
  );
  pty.onData(handlers.onData);
  pty.onExit(() => handlers.onExit());

  return {
    write: (data) => pty.write(data),
    resize: ({ cols, rows }) => pty.resize(cols, rows),
    // The pty is already gone once tmux exits on its own, and killing a reaped
    // process would throw an ESRCH the caller cannot act on.
    kill: () => {
      try {
        pty.kill();
      } catch {
        // Already exited.
      }
    },
  };
}
