import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEventsFollow, type PipeSocket } from './events.js';
import type { WritableLike } from './io.js';

type Listener = (event: { data?: unknown }) => void;

class FakeSocket implements PipeSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(private readonly log: string[]) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void {
    this.sent.push(data);
    this.log.push(`ack:${data}`);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
  digest(id: string, line: string): void {
    this.emit('message', JSON.stringify({ type: 'digest', id, line }));
  }
}

function sink(log: string[], label: string, failWith?: Error): WritableLike & { text: string[] } {
  const text: string[] = [];
  return {
    text,
    write(chunk, callback) {
      if (failWith) {
        callback?.(failWith);
        return;
      }
      text.push(chunk);
      log.push(`${label}:${chunk}`);
      callback?.();
    },
  };
}

function setup(env: NodeJS.ProcessEnv = { GARDEN_SESSION_ID: 's1', CLAUDE_CODE_SESSION_ID: 's1' }) {
  const log: string[] = [];
  const out = sink(log, 'out');
  const stderr = sink(log, 'err');
  let resolveGone!: () => void;
  const gone = new Promise<void>((resolve) => {
    resolveGone = resolve;
  });
  const sockets: FakeSocket[] = [];
  const connect = vi.fn<(sessionId: string) => PipeSocket>(() => {
    const socket = new FakeSocket(log);
    sockets.push(socket);
    return socket;
  });
  const sleep = vi.fn(
    (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        });
      }),
  );
  const run = runEventsFollow({ env, out, stderr, gone, connect, sleep });
  const state = { returned: false };
  void run.then(() => {
    state.returned = true;
  });
  return { log, out, stderr, resolveGone, sockets, connect, sleep, run, state };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('runEventsFollow blocked states', () => {
  it.each([
    ['an unset GARDEN_SESSION_ID', { CLAUDE_CODE_SESSION_ID: 's1' }],
    ['a mismatched Claude session id', { GARDEN_SESSION_ID: 's1', CLAUDE_CODE_SESSION_ID: 's2' }],
  ])('stays idle and silent with %s until gone resolves', async (_name, env) => {
    const t = setup(env);
    await flush();

    expect(t.state.returned).toBe(false);
    expect(t.connect).not.toHaveBeenCalled();
    expect(t.log).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    t.resolveGone();
    expect(await t.run).toBe(0);
    expect(t.log).toEqual([]);
  });
});

describe('runEventsFollow', () => {
  it('connects as the garden session id', async () => {
    const t = setup();
    await flush();
    expect(t.connect).toHaveBeenCalledWith('s1');
    t.resolveGone();
    await t.run;
  });

  it('writes a digest to out before sending its ack', async () => {
    const t = setup();
    await flush();

    t.sockets[0]!.digest('d1', 'hello');
    await flush();

    expect(t.log).toEqual(['out:hello\n', `ack:${JSON.stringify({ type: 'ack', id: 'd1' })}`]);
    t.resolveGone();
    await t.run;
  });

  it('reconnects after a close and keeps delivering', async () => {
    const t = setup();
    await flush();
    t.sockets[0]!.emit('close');
    await flush();
    await vi.advanceTimersByTimeAsync(500);

    expect(t.sockets).toHaveLength(2);
    t.sockets[1]!.digest('d2', 'again');
    await flush();
    expect(t.out.text).toEqual(['again\n']);
    t.resolveGone();
    await t.run;
  });

  it('retries a connect that throws instead of ending', async () => {
    const t = setup();
    await flush();
    t.connect.mockImplementationOnce(() => {
      throw new Error('no server');
    });
    t.sockets[0]!.emit('close');
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);

    expect(t.state.returned).toBe(false);
    expect(t.connect).toHaveBeenCalledTimes(3);
    t.resolveGone();
    await t.run;
  });

  it('writes one stderr diagnostic per outage and nothing but digests to out', async () => {
    const t = setup();
    await flush();
    t.sockets[0]!.emit('close');
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    t.sockets[1]!.emit('error');
    await flush();
    await vi.advanceTimersByTimeAsync(1000);

    expect(t.stderr.text).toHaveLength(1);
    expect(t.out.text).toEqual([]);

    t.sockets[2]!.emit('open');
    t.sockets[2]!.emit('close');
    await flush();
    expect(t.stderr.text).toHaveLength(2);
    t.resolveGone();
    await t.run;
  });

  it('returns 0, closes the socket and leaves no timer when gone resolves mid-backoff', async () => {
    const t = setup();
    await flush();
    t.sockets[0]!.emit('close');
    await flush();
    expect(vi.getTimerCount()).toBe(1);

    t.resolveGone();

    expect(await t.run).toBe(0);
    expect(t.sockets[0]!.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns 0 when a write to out fails', async () => {
    const log: string[] = [];
    const sockets: FakeSocket[] = [];
    const run = runEventsFollow({
      env: { GARDEN_SESSION_ID: 's1', CLAUDE_CODE_SESSION_ID: 's1' },
      out: sink(log, 'out', new Error('EPIPE')),
      stderr: sink(log, 'err'),
      gone: new Promise<void>(() => undefined),
      connect: () => {
        const socket = new FakeSocket(log);
        sockets.push(socket);
        return socket;
      },
    });
    await flush();

    sockets[0]!.digest('d1', 'x');

    expect(await run).toBe(0);
    expect(log).toEqual([]);
  });

  it('keeps delivering digests when a write to stderr fails', async () => {
    const log: string[] = [];
    const sockets: FakeSocket[] = [];
    const out = sink(log, 'out');
    let resolveGone!: () => void;
    const run = runEventsFollow({
      env: { GARDEN_SESSION_ID: 's1', CLAUDE_CODE_SESSION_ID: 's1' },
      out,
      stderr: sink(log, 'err', new Error('EPIPE')),
      gone: new Promise<void>((resolve) => {
        resolveGone = resolve;
      }),
      connect: () => {
        const socket = new FakeSocket(log);
        sockets.push(socket);
        return socket;
      },
      sleep: () => Promise.resolve(),
    });
    await flush();
    sockets[0]!.emit('close');
    await flush();

    expect(sockets).toHaveLength(2);
    sockets[1]!.digest('d1', 'x');
    await flush();
    expect(out.text).toEqual(['x\n']);

    resolveGone();
    expect(await run).toBe(0);
  });

  it.each([['not json'], [JSON.stringify({ type: 'digest', id: 'd1' })], [42]])(
    'drops a malformed frame (%j) and keeps running',
    async (frame) => {
      const t = setup();
      await flush();

      t.sockets[0]!.emit('message', frame);
      await flush();

      expect(t.state.returned).toBe(false);
      expect(t.log).toEqual([]);
      t.resolveGone();
      await t.run;
    },
  );
});
