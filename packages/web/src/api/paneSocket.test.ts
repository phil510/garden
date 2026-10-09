import { PANE_CLOSE_CODES } from '@garden/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from './fakeWebSocket';
import { connectPaneSocket, paneCloseDisposition } from './paneSocket';
import { nextReconnectDelayMs } from './reconnectingSocket';

describe('paneCloseDisposition', () => {
  it('disposes when the server refused a state no retry moves', () => {
    expect(paneCloseDisposition(4000)).toBe('dispose');
    expect(paneCloseDisposition(4001)).toBe('dispose');
    expect(paneCloseDisposition(4004)).toBe('dispose');
  });

  it('disposes on a normal close, which is the pty having exited', () => {
    expect(paneCloseDisposition(1000)).toBe('dispose');
  });

  it('reconnects on a refusal the server can stop making', () => {
    expect(paneCloseDisposition(4009)).toBe('reconnect');
    expect(paneCloseDisposition(4500)).toBe('reconnect');
  });

  it('reconnects on a close the server never attributed to a state', () => {
    expect(paneCloseDisposition(1006)).toBe('reconnect');
    expect(paneCloseDisposition(1001)).toBe('reconnect');
    expect(paneCloseDisposition(1011)).toBe('reconnect');
  });
});

describe('connectPaneSocket', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  function stubGlobals() {
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:4310' });
    vi.stubGlobal('WebSocket', FakeWebSocket);
  }

  it('decodes a multi-byte UTF-8 character split across two frames', () => {
    stubGlobals();

    const chunks: string[] = [];
    connectPaneSocket(
      'session-1',
      { cols: 80, rows: 24 },
      { onData: (chunk) => chunks.push(chunk), onClose: () => {} },
    );
    const socket = FakeWebSocket.instances.at(-1)!;

    // 'é' (U+00E9) encodes to the two UTF-8 bytes 0xC3 0xA9; split them across separate frames.
    socket.emit('message', { data: new Uint8Array([0xc3]).buffer });
    socket.emit('message', { data: new Uint8Array([0xa9]).buffer });

    expect(chunks.join('')).toBe('é');
    expect(chunks.join('')).not.toContain('�');
  });

  it('reconnects at the size the pane is now, not the size it was opened at', () => {
    vi.useFakeTimers();
    stubGlobals();

    const pane = connectPaneSocket(
      'session-1',
      { cols: 80, rows: 24 },
      { onData: () => {}, onClose: () => {} },
    );
    pane.resize({ cols: 100, rows: 30 });
    FakeWebSocket.instances.at(-1)!.emit('close', { code: 1006 });
    vi.advanceTimersByTime(nextReconnectDelayMs(0));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances.at(-1)!.url).toContain('cols=100&rows=30');
  });

  it('reports a close the pty settled and does not reconnect', () => {
    vi.useFakeTimers();
    stubGlobals();

    const onClose = vi.fn();
    connectPaneSocket('session-1', { cols: 80, rows: 24 }, { onData: () => {}, onClose });
    FakeWebSocket.instances.at(-1)!.emit('close', { code: PANE_CLOSE_CODES.PTY_EXITED });

    vi.runAllTimers();
    expect(onClose).toHaveBeenCalledWith(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
