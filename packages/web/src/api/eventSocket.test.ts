import { EVENTS_CLOSE_CODES } from '@garden/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { connectEventSocket, eventCloseDisposition, type EventSocketHandlers } from './eventSocket';
import { FakeWebSocket } from './fakeWebSocket';
import { nextReconnectDelayMs } from './reconnectingSocket';

describe('eventCloseDisposition', () => {
  it('is terminal on the deliberate-shutdown code', () => {
    expect(eventCloseDisposition(4100)).toBe('terminal');
  });

  it('reconnects on every other code, including a plain dropped connection', () => {
    expect(eventCloseDisposition(1000)).toBe('reconnect');
    expect(eventCloseDisposition(1006)).toBe('reconnect');
    expect(eventCloseDisposition(1001)).toBe('reconnect');
    expect(eventCloseDisposition(1011)).toBe('reconnect');
  });
});

describe('connectEventSocket', () => {
  const handlers = {
    onSnapshot: vi.fn(),
    onDeltas: vi.fn(),
    onUiState: vi.fn(),
    onConnect: vi.fn(),
    onFsChanged: vi.fn(),
    onShutdown: vi.fn(),
  } satisfies EventSocketHandlers;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:4310' });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const handler of Object.values(handlers)) handler.mockReset();
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  const latest = () => FakeWebSocket.instances.at(-1)!;

  it.each(['not json', 'null', '{"type":"bogus"}'])(
    'drops the malformed frame %s and keeps dispatching',
    (frame) => {
      connectEventSocket(handlers);
      const socket = latest();

      expect(() => socket.emit('message', { data: frame })).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();

      socket.emit('message', { data: '{"type":"deltas","deltas":[]}' });
      expect(handlers.onDeltas).toHaveBeenCalledWith({ type: 'deltas', deltas: [] });
    },
  );

  it('re-sends the watched root and fires onConnect again after a reconnect', () => {
    const controller = connectEventSocket(handlers);
    controller.watch('/r');
    const first = latest();
    first.readyState = FakeWebSocket.OPEN;
    first.emit('open');
    first.emit('close', { code: 1006 });
    vi.advanceTimersByTime(nextReconnectDelayMs(0));

    const second = latest();
    expect(second).not.toBe(first);
    second.readyState = FakeWebSocket.OPEN;
    second.emit('open');

    expect(second.sent).toEqual([JSON.stringify({ type: 'watch', root: '/r' })]);
    expect(handlers.onConnect).toHaveBeenCalledTimes(2);
  });

  it('reports a deliberate shutdown and does not reconnect', () => {
    connectEventSocket(handlers);
    latest().emit('close', { code: EVENTS_CLOSE_CODES.DELIBERATE_SHUTDOWN });

    vi.runAllTimers();
    expect(handlers.onShutdown).toHaveBeenCalledOnce();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
