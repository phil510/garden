import type { AddressInfo } from 'node:net';
import type { PipeServerMessage } from '@garden/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { Pipes } from '../../app/pipes.js';
import { pipeSessionId, registerPipeSocket } from './pipe.js';

async function until(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Records what the socket hands the registry; `sends` collects the digest sinks it was given. */
function fakePipes(throwOn?: 'connect' | 'ack' | 'close') {
  const log = {
    connected: [] as string[],
    acks: [] as string[],
    closed: 0,
    sends: [] as ((message: PipeServerMessage) => void)[],
  };
  const pipes: Pipes = {
    connect: (sessionId, send) => {
      if (throwOn === 'connect') throw new Error('state.json is not writable');
      log.connected.push(sessionId);
      log.sends.push(send);
      return {
        ack: (id) => {
          if (throwOn === 'ack') throw new Error('state.json is not writable');
          log.acks.push(id);
        },
        close: () => {
          if (throwOn === 'close') throw new Error('state.json is not writable');
          log.closed += 1;
        },
      };
    },
    sweep: () => undefined,
    replay: () => undefined,
  };
  return { pipes, log };
}

describe('pipeSessionId', () => {
  it('reads the session id from a pipe stream path and rejects other paths', () => {
    expect(pipeSessionId('/sessions/abc/events')).toBe('abc');
    expect(pipeSessionId('/sessions/a%20b/events')).toBe('a b');
    expect(pipeSessionId('/events')).toBeUndefined();
    expect(pipeSessionId('/sessions/abc/watches')).toBeUndefined();
    expect(pipeSessionId('/sessions//events')).toBeUndefined();
    expect(pipeSessionId('/sessions/%E0%A4%A/events')).toBeUndefined();
  });
});

describe('registerPipeSocket', () => {
  let app: FastifyInstance | undefined;
  let socket: WebSocket | undefined;

  afterEach(async () => {
    socket?.close();
    await app?.close();
    app = undefined;
    socket = undefined;
  });

  it('connects by URL id, delivers digests, passes acks through and closes on disconnect', async () => {
    const { pipes, log } = fakePipes();
    app = Fastify();
    const wss = registerPipeSocket(app, { pipes });
    app.server.on('upgrade', (request, rawSocket, head) => {
      wss.handleUpgrade(request, rawSocket, head, (ws) => wss.emit('connection', ws, request));
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    socket = new WebSocket(`ws://127.0.0.1:${String(port)}/sessions/s1/events`);
    const received: string[] = [];
    socket.on('message', (data: Buffer) => received.push(data.toString('utf8')));
    await new Promise<void>((resolve, reject) => {
      socket?.once('open', resolve);
      socket?.once('error', reject);
    });
    await until(() => log.sends.length === 1, 'the connection to reach the registry');
    expect(log.connected).toEqual(['s1']);

    log.sends[0]?.({ type: 'digest', id: 'd1', line: 'hello' });
    await until(() => received.length === 1, 'the digest frame');
    expect(JSON.parse(received[0] ?? '')).toEqual({ type: 'digest', id: 'd1', line: 'hello' });

    socket.send('not json');
    socket.send(JSON.stringify({ type: 'ack', id: 7 }));
    socket.send(JSON.stringify({ type: 'other', id: 'x' }));
    socket.send(Buffer.from([1, 2, 3]));
    socket.send(JSON.stringify({ type: 'ack', id: 'd1' }));
    await until(() => log.acks.length > 0, 'the ack frame');
    expect(log.acks).toEqual(['d1']);
    expect(socket.readyState).toBe(WebSocket.OPEN);

    socket.close();
    await until(() => log.closed === 1, 'the registry connection to be closed');
  });

  async function open(pipes: Pipes): Promise<WebSocket> {
    app = Fastify();
    const wss = registerPipeSocket(app, { pipes });
    app.server.on('upgrade', (request, rawSocket, head) => {
      wss.handleUpgrade(request, rawSocket, head, (ws) => wss.emit('connection', ws, request));
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    socket = new WebSocket(`ws://127.0.0.1:${String(port)}/sessions/s1/events`);
    return socket;
  }

  it('terminates the socket when the registry throws on connect', async () => {
    const { pipes, log } = fakePipes('connect');
    const ws = await open(pipes);
    ws.on('error', () => undefined);
    await new Promise<void>((resolve) => ws.once('close', () => resolve()));
    expect(log.closed).toBe(0);
  });

  it('terminates the socket, without crashing the process, when an ack throws', async () => {
    const { pipes } = fakePipes('ack');
    const ws = await open(pipes);
    ws.on('error', () => undefined);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'ack', id: 'd1' }));
    await new Promise<void>((resolve) => ws.once('close', () => resolve()));
  });

  it('survives the registry throwing on close', async () => {
    const { pipes } = fakePipes('close');
    const ws = await open(pipes);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.close();
    await new Promise<void>((resolve) => ws.once('close', () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
