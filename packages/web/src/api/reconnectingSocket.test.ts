import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from './fakeWebSocket.fixture';
import { connectReconnectingSocket, nextReconnectDelayMs } from './reconnectingSocket';

describe('nextReconnectDelayMs', () => {
  it('starts at the initial delay on the first attempt', () => {
    expect(nextReconnectDelayMs(0)).toBe(250);
  });

  it('doubles with each attempt', () => {
    expect(nextReconnectDelayMs(1)).toBe(500);
    expect(nextReconnectDelayMs(2)).toBe(1000);
    expect(nextReconnectDelayMs(3)).toBe(2000);
  });

  it('caps at the maximum delay rather than growing without bound', () => {
    expect(nextReconnectDelayMs(10)).toBe(10_000);
    expect(nextReconnectDelayMs(100)).toBe(10_000);
  });
});

describe('connectReconnectingSocket', () => {
  const onClose = vi.fn<(code: number) => 'reconnect' | 'stop'>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    onClose.mockReset().mockReturnValue('reconnect');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  function connect() {
    return connectReconnectingSocket({ url: () => 'ws://test/x', setup: () => {}, onClose });
  }

  const latest = () => FakeWebSocket.instances.at(-1)!;

  it('opens a new socket after the backoff delay following a reconnectable close, and not before', () => {
    connect();
    latest().emit('close', { code: 1006 });

    vi.advanceTimersByTime(nextReconnectDelayMs(0) - 1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('backs off with growing delays across consecutive failed attempts', () => {
    connect();
    latest().emit('close', { code: 1006 });
    vi.advanceTimersByTime(nextReconnectDelayMs(0));
    latest().emit('close', { code: 1006 });

    vi.advanceTimersByTime(nextReconnectDelayMs(1) - 1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('resets the backoff once a connection opens', () => {
    connect();
    latest().emit('close', { code: 1006 });
    vi.advanceTimersByTime(nextReconnectDelayMs(0));
    latest().emit('open');
    latest().emit('close', { code: 1006 });

    vi.advanceTimersByTime(nextReconnectDelayMs(0) - 1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('closes the live socket on close() and does not reconnect after it', () => {
    const socket = connect();
    const first = latest();
    socket.close();
    expect(first.closeCalled).toBe(true);

    first.emit('close', { code: 1000 });
    vi.runAllTimers();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels a pending reconnect on close()', () => {
    const socket = connect();
    latest().emit('close', { code: 1006 });
    socket.close();

    vi.runAllTimers();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('does not reconnect when onClose says stop', () => {
    onClose.mockReturnValue('stop');
    connect();
    latest().emit('close', { code: 4100 });

    vi.runAllTimers();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
