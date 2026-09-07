import { PANE_CLOSE_CODES, type PaneResizeMessage } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AttachRegistry } from '../../app/attach.js';
import { SessionAlreadyAttachedError, SessionNotRunningError } from '../../app/attach.js';
import type { PaneSize } from '../../app/ports.js';
import { SessionNotFoundError } from '../../app/sessions.js';

export interface AttachSocketDeps {
  readonly attach: AttachRegistry;
}

function toSize(cols: unknown, rows: unknown): PaneSize | undefined {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return undefined;
  if ((cols as number) <= 0 || (rows as number) <= 0) return undefined;
  return { cols: cols as number, rows: rows as number };
}

function parseSize(url: URL): PaneSize | undefined {
  return toSize(Number(url.searchParams.get('cols')), Number(url.searchParams.get('rows')));
}

/** A text frame is client input: anything that is not a resize with usable dimensions is
 *  dropped. A throw in a `message` listener is an uncaught exception, not a socket error. */
function parseResize(frame: string): PaneSize | undefined {
  let message: unknown;
  try {
    message = JSON.parse(frame);
  } catch {
    return undefined;
  }
  if (typeof message !== 'object' || message === null) return undefined;
  const { cols, rows } = message as Partial<PaneResizeMessage>;
  return toSize(cols, rows);
}

/** `noServer` mode: `http/server.ts` owns the single `upgrade` listener on the shared HTTP
 *  server and dispatches to this `wss` for any `/attach/<id>` path. */
export function registerAttachSocket(
  app: FastifyInstance,
  deps: AttachSocketDeps,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  // An upgraded socket keeps the HTTP server from closing, and that happens before `onClose`
  // runs — so the clients have to go in `preClose`. `wss.close()` terminates none of them itself.
  app.addHook('preClose', () => {
    for (const client of wss.clients) client.terminate();
  });
  app.addHook('onClose', (_instance, done) => wss.close(() => done()));

  wss.on('connection', (socket: WebSocket, request) => {
    // A malformed frame emits `error` on the socket, which is fatal to the process if unhandled.
    socket.on('error', () => socket.terminate());

    const url = new URL(request.url ?? '', 'http://localhost');
    const id = url.pathname.slice('/attach/'.length);
    const size = parseSize(url);
    if (size === undefined) {
      socket.close(PANE_CLOSE_CODES.BAD_REQUEST, 'cols and rows query parameters are required');
      return;
    }

    let attachment;
    try {
      attachment = deps.attach.attach({
        id,
        size,
        onData: (chunk) => socket.send(Buffer.from(chunk, 'utf8')),
        onExit: () => socket.close(PANE_CLOSE_CODES.PTY_EXITED),
      });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        socket.close(PANE_CLOSE_CODES.SESSION_NOT_FOUND, error.message);
      } else if (error instanceof SessionNotRunningError) {
        socket.close(PANE_CLOSE_CODES.SESSION_NOT_RUNNING, error.message);
      } else if (error instanceof SessionAlreadyAttachedError) {
        socket.close(PANE_CLOSE_CODES.ALREADY_ATTACHED, error.message);
      } else {
        // Rethrowing here would be an uncaught exception in a `ws` listener, taking every
        // other pane socket down with this one.
        socket.close(PANE_CLOSE_CODES.ATTACH_FAILED, 'attach failed');
      }
      return;
    }

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        attachment.write(data.toString('utf8'));
        return;
      }
      const nextSize = parseResize(data.toString('utf8'));
      if (nextSize !== undefined) attachment.resize(nextSize);
    });
    socket.on('close', () => attachment.close());
  });

  return wss;
}
