import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectPaneSocket, paneCloseDisposition } from './paneSocket';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  binaryType = '';
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const forType = this.listeners.get(type) ?? [];
    forType.push(listener);
    this.listeners.set(type, forType);
  }

  send(): void {}
  close(): void {}

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

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

describe('connectPaneSocket frame decoding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it('decodes a multi-byte UTF-8 character split across two frames', () => {
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:4310' });
    vi.stubGlobal('WebSocket', MockWebSocket);

    const chunks: string[] = [];
    connectPaneSocket(
      'session-1',
      { cols: 80, rows: 24 },
      { onData: (chunk) => chunks.push(chunk), onClose: () => {} },
    );
    const socket = MockWebSocket.instances.at(-1)!;

    // 'é' (U+00E9) encodes to the two UTF-8 bytes 0xC3 0xA9; split them across separate frames.
    socket.emit('message', { data: new Uint8Array([0xc3]).buffer });
    socket.emit('message', { data: new Uint8Array([0xa9]).buffer });

    expect(chunks.join('')).toBe('é');
    expect(chunks.join('')).not.toContain('�');
  });
});
