import type { PipeClientMessage, PipeServerMessage } from '@garden/shared';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Pipes } from '../../app/pipes.js';

export interface PipeDeps {
  readonly pipes: Pipes;
}

const PIPE_PATH = /^\/sessions\/([^/]+)\/events$/;

/** The session id of a pipe stream URL path, or undefined when the path is not one. */
export function pipeSessionId(pathname: string): string | undefined {
  const match = PIPE_PATH.exec(pathname);
  if (match?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function send(socket: WebSocket, message: PipeServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

/** A text frame is client input: anything but an `ack` with a string id is dropped. A throw in
 *  a `message` listener is an uncaught exception, not a socket error. */
function parseAck(frame: string): PipeClientMessage | undefined {
  let message: unknown;
  try {
    message = JSON.parse(frame);
  } catch {
    return undefined;
  }
  if (typeof message !== 'object' || message === null) return undefined;
  const { type, id } = message as Partial<PipeClientMessage>;
  return type === 'ack' && typeof id === 'string' ? { type, id } : undefined;
}

/** `noServer` mode: `http/server.ts` owns the single `upgrade` listener and dispatches to this
 *  `wss` by path. The session id comes from the URL. */
export function registerPipeSocket(app: FastifyInstance, deps: PipeDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  // An upgraded socket keeps the HTTP server from closing before `onClose` runs, and a pipe
  // never ends on its own, so its sockets are terminated in `preClose`.
  app.addHook('preClose', () => {
    for (const client of wss.clients) client.terminate();
  });
  app.addHook('onClose', (_instance, done) => wss.close(() => done()));

  wss.on('connection', (socket, request) => {
    socket.on('error', () => socket.terminate());
    const sessionId = pipeSessionId(new URL(request.url ?? '', 'http://localhost').pathname);
    if (sessionId === undefined || sessionId === '') {
      socket.terminate();
      return;
    }
    const connection = deps.pipes.connect(sessionId, (message) => send(socket, message));
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const message = parseAck(data.toString('utf8'));
      if (message !== undefined) connection.ack(message.id);
    });
    socket.on('close', () => connection.close());
  });

  return wss;
}
