import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionAlreadyAttachedError, SessionNotRunningError } from '../../app/attach.js';
import type { AttachRegistry, AttachRequest, Attachment } from '../../app/attach.js';
import type { PaneSize } from '../../app/ports.js';
import { SessionNotFoundError } from '../../app/sessions.js';
import { registerAttachSocket } from './attach.js';

/** Polls until `predicate` holds or the deadline passes, failing with the last observation. */
async function until<T>(
  probe: () => T,
  predicate: (value: T) => boolean,
  description: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = probe();
  while (!predicate(last)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${description}. Last observation: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    last = probe();
  }
  return last;
}

/** A registry whose one attach succeeds, recording writes and resizes and handing back the
 *  levers a test needs to drive the far end: pty output arriving, and the attachment closing. */
function attachingRegistry() {
  let request: AttachRequest | undefined;
  const written: string[] = [];
  const resizes: PaneSize[] = [];
  let closed = false;
  const registry: AttachRegistry = {
    attach: (req) => {
      request = req;
      const attachment: Attachment = {
        write: (data) => written.push(data),
        resize: (size) => resizes.push(size),
        close: () => {
          closed = true;
        },
      };
      return attachment;
    },
  };
  return {
    registry,
    written,
    resizes,
    isClosed: () => closed,
    emitData: (chunk: string) => request?.onData(chunk),
  };
}

/** A registry whose one attach always refuses, for exercising the close-code mapping. */
function refusingRegistry(error: Error): AttachRegistry {
  return {
    attach: () => {
      throw error;
    },
  };
}

async function startServer(registry: AttachRegistry): Promise<{
  app: FastifyInstance;
  url: (path: string) => string;
}> {
  const app = Fastify();
  const wss = registerAttachSocket(app, { attach: registry });
  // `registerAttachSocket` runs in `noServer` mode; production wiring of the shared
  // `upgrade` listener lives in `http/server.ts`, so this standalone test does it too.
  app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: (path) => `ws://127.0.0.1:${String(port)}${path}` };
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function closed(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
  });
}

describe('registerAttachSocket', () => {
  let app: FastifyInstance | undefined;
  let socket: WebSocket | undefined;

  afterEach(async () => {
    socket?.close();
    await app?.close();
    app = undefined;
    socket = undefined;
  });

  it('forwards binary frames to the pty and JSON frames to resize', async () => {
    const { registry, written, resizes } = attachingRegistry();
    const server = await startServer(registry);
    app = server.app;

    socket = new WebSocket(server.url('/attach/one?cols=80&rows=24'));
    await opened(socket);

    socket.send(Buffer.from('ls\r', 'utf8'));
    socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));

    await until(
      () => written.length,
      (length) => length === 1,
      'the pty write to arrive',
    );
    expect(written).toEqual(['ls\r']);
    await until(
      () => resizes.length,
      (length) => length === 1,
      'the resize to arrive',
    );
    expect(resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('drops a text frame that is not a usable resize, keeping the connection open', async () => {
    const { registry, written, resizes } = attachingRegistry();
    const server = await startServer(registry);
    app = server.app;

    socket = new WebSocket(server.url('/attach/one?cols=80&rows=24'));
    await opened(socket);

    socket.send('not json at all');
    socket.send(JSON.stringify({ type: 'resize' }));
    socket.send(JSON.stringify({ type: 'resize', cols: 0, rows: -4 }));
    socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));

    await until(
      () => resizes.length,
      (length) => length === 1,
      'the one usable resize to arrive',
    );
    expect(resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(written).toEqual([]);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it('closes with a distinguishable code when the attach fails unexpectedly', async () => {
    const server = await startServer(refusingRegistry(new Error('pty layer blew up')));
    app = server.app;

    socket = new WebSocket(server.url('/attach/one?cols=80&rows=24'));
    const result = await closed(socket);

    expect(result.code).toBe(4500);
  });

  it('delivers pty output to the client as a binary frame', async () => {
    const { registry, emitData } = attachingRegistry();
    const server = await startServer(registry);
    app = server.app;

    socket = new WebSocket(server.url('/attach/one?cols=80&rows=24'));
    await opened(socket);
    const nextMessage = new Promise<Buffer>((resolve) => socket?.once('message', resolve));

    emitData('hello');

    expect((await nextMessage).toString('utf8')).toBe('hello');
  });

  it('closes the attachment when the client disconnects', async () => {
    const { registry, isClosed } = attachingRegistry();
    const server = await startServer(registry);
    app = server.app;

    socket = new WebSocket(server.url('/attach/one?cols=80&rows=24'));
    await opened(socket);
    socket.close();

    await until(isClosed, (value) => value, 'the attachment to close');
  });

  it('refuses a connection missing cols or rows', async () => {
    const server = await startServer(refusingRegistry(new Error('never called')));
    app = server.app;

    socket = new WebSocket(server.url('/attach/one'));
    const result = await closed(socket);

    expect(result.code).toBe(4000);
  });

  it('closes with a distinguishable code for an unknown session', async () => {
    const server = await startServer(
      refusingRegistry(new SessionNotFoundError('no such session: one')),
    );
    app = server.app;

    socket = new WebSocket(server.url('/attach/one?cols=80&rows=24'));
    const result = await closed(socket);

    expect(result.code).toBe(4004);
  });

  it('closes with a distinguishable code for a session tmux no longer holds', async () => {
    const server = await startServer(
      refusingRegistry(new SessionNotRunningError('session has no tmux session: one')),
    );
    app = server.app;

    socket = new WebSocket(server.url('/attach/one?cols=80&rows=24'));
    const result = await closed(socket);

    expect(result.code).toBe(4001);
  });

  it('closes with a distinguishable code for an already-attached session', async () => {
    const server = await startServer(
      refusingRegistry(new SessionAlreadyAttachedError('session is already attached: one')),
    );
    app = server.app;

    socket = new WebSocket(server.url('/attach/one?cols=80&rows=24'));
    const result = await closed(socket);

    expect(result.code).toBe(4009);
  });
});
