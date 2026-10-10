type Listener = (event: unknown) => void;

/** A stand-in for the `WebSocket` global. Tests set `readyState` and call `emit` to drive the
 *  events a real socket would fire. */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType = '';
  closeCalled = false;
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const forType = this.listeners.get(type) ?? [];
    forType.push(listener);
    this.listeners.set(type, forType);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalled = true;
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
