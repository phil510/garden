// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneSize, PaneSocketHandlers } from '../api/paneSocket.js';

// The registry is garden's one imperative escape hatch (docs/architecture.md §5.1): all it holds
// is the wiring between xterm, the fit addon, a ResizeObserver and a pane socket, and that wiring
// is what breaks. Standing each collaborator in for the real thing is what makes the wiring
// observable — the same reason `dockview-identity.test.ts` needs a DOM.

class FakeTerminal {
  static instances: FakeTerminal[] = [];
  element: HTMLElement | undefined;
  readonly resizes: PaneSize[] = [];
  disposed = false;
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | undefined;

  constructor() {
    FakeTerminal.instances.push(this);
  }
  loadAddon(): void {}
  open(container: HTMLElement): void {
    this.element = document.createElement('div');
    container.appendChild(this.element);
  }
  registerLinkProvider(): void {}
  onData(): void {}
  write(): void {}
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.customKeyEventHandler = handler;
  }
  dispose(): void {
    this.disposed = true;
  }
}

/** What the container's size is worth in cells. The registry never sees the container itself, so
 *  scripting this is how a test says "the pane got bigger". */
let proposed: PaneSize | undefined;

class FakeFitAddon {
  proposeDimensions(): PaneSize | undefined {
    return proposed;
  }
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly resizes: PaneSize[] = [];
  closed = false;

  constructor(
    readonly initialSize: PaneSize,
    readonly handlers: PaneSocketHandlers,
  ) {
    FakeSocket.instances.push(this);
  }
  write(): void {}
  resize(size: PaneSize): void {
    this.resizes.push(size);
  }
  close(): void {
    this.closed = true;
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];

  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(target: Element): void {
    this.observed = this.observed.filter((entry) => entry !== target);
  }
  disconnect(): void {
    this.observed = [];
  }
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }));
vi.mock('../api/paneSocket.js', () => ({
  connectPaneSocket: (_sessionId: string, size: PaneSize, handlers: PaneSocketHandlers) =>
    new FakeSocket(size, handlers),
}));

type Registry = typeof import('./registry.js');

/** A fresh module per test: the pane map is module state by design. */
async function loadRegistry(): Promise<Registry> {
  vi.resetModules();
  return import('./registry.js');
}

/** Containers only have a size in happy-dom if one is declared, which is what the fit guard
 *  reads — so an undeclared size is also the zero-size case. */
function aContainer(size?: { width: string; height: string }): HTMLElement {
  const container = document.createElement('div');
  if (size !== undefined) {
    container.style.width = size.width;
    container.style.height = size.height;
  }
  document.body.appendChild(container);
  return container;
}

function lastTerminal(): FakeTerminal {
  const terminal = FakeTerminal.instances.at(-1);
  if (terminal === undefined) throw new Error('no terminal was created');
  return terminal;
}

function lastSocket(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (socket === undefined) throw new Error('no socket was opened');
  return socket;
}

/** Every observer the registry is currently holding open. */
function liveObservers(): FakeResizeObserver[] {
  return FakeResizeObserver.instances.filter((observer) => observer.observed.length > 0);
}

function resizeContainer(container: HTMLElement, size: PaneSize): void {
  proposed = size;
  for (const observer of liveObservers()) {
    if (observer.observed.includes(container)) observer.callback();
  }
}

beforeEach(() => {
  FakeTerminal.instances = [];
  FakeSocket.instances = [];
  FakeResizeObserver.instances = [];
  proposed = { cols: 100, rows: 30 };
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('attachPane', () => {
  it('resizes the terminal and the pty when the pane container changes size', async () => {
    const { attachPane } = await loadRegistry();
    const container = aContainer({ width: '800px', height: '600px' });
    attachPane('session-a', container, 0);
    const terminal = lastTerminal();
    const socket = lastSocket();

    resizeContainer(container, { cols: 120, rows: 40 });

    expect(terminal.resizes.at(-1)).toEqual({ cols: 120, rows: 40 });
    expect(socket.resizes.at(-1)).toEqual({ cols: 120, rows: 40 });
  });

  it('observes the container it was given on the very first attach', async () => {
    const { attachPane } = await loadRegistry();
    const container = aContainer({ width: '800px', height: '600px' });

    attachPane('session-a', container, 0);

    expect(liveObservers().flatMap((observer) => observer.observed)).toEqual([container]);
  });

  it('keeps the terminal and its socket when React remounts the pane into a new container', async () => {
    const { attachPane } = await loadRegistry();
    const first = aContainer({ width: '800px', height: '600px' });
    attachPane('session-a', first, 0);
    const terminal = lastTerminal();
    const socket = lastSocket();

    const second = aContainer({ width: '400px', height: '300px' });
    attachPane('session-a', second, 0);

    expect(FakeTerminal.instances).toHaveLength(1);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(terminal.element?.parentElement).toBe(second);
    expect(socket.closed).toBe(false);
  });

  it('tracks the new container after a remount and stops tracking the old one', async () => {
    const { attachPane } = await loadRegistry();
    const first = aContainer({ width: '800px', height: '600px' });
    attachPane('session-a', first, 0);
    const second = aContainer({ width: '400px', height: '300px' });
    attachPane('session-a', second, 0);
    const terminal = lastTerminal();

    resizeContainer(second, { cols: 60, rows: 20 });

    expect(terminal.resizes.at(-1)).toEqual({ cols: 60, rows: 20 });
    expect(liveObservers().flatMap((observer) => observer.observed)).toEqual([second]);
  });

  it('replaces a pane held over from an earlier connection epoch', async () => {
    const { attachPane } = await loadRegistry();
    const container = aContainer({ width: '800px', height: '600px' });
    attachPane('session-a', container, 0);
    const stale = lastSocket();

    attachPane('session-a', container, 1);

    expect(stale.closed).toBe(true);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(lastSocket().closed).toBe(false);
  });

  it('opens the pty at the fallback size when the container has no size yet', async () => {
    const { attachPane } = await loadRegistry();
    proposed = { cols: Number.NaN, rows: Number.NaN };

    attachPane('session-a', aContainer(), 0);

    expect(lastSocket().initialSize).toEqual({ cols: 80, rows: 24 });
  });

  it('registers a custom key event handler on the terminal', async () => {
    const { attachPane } = await loadRegistry();

    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);

    expect(lastTerminal().customKeyEventHandler).toBeInstanceOf(Function);
  });
});

describe('fitting a pane with nothing to fit to', () => {
  it('leaves the pty alone when the container has no size', async () => {
    const { attachPane } = await loadRegistry();
    const container = aContainer();
    attachPane('session-a', container, 0);

    resizeContainer(container, { cols: 2, rows: 1 });

    expect(lastSocket().resizes).toEqual([]);
    expect(lastTerminal().resizes).toEqual([{ cols: 80, rows: 24 }]);
  });

  it('leaves the pty alone when the fit addon proposes NaN', async () => {
    const { attachPane } = await loadRegistry();
    const container = aContainer({ width: '800px', height: '600px' });
    attachPane('session-a', container, 0);
    const terminalResizes = lastTerminal().resizes.length;
    const socketResizes = lastSocket().resizes.length;

    resizeContainer(container, { cols: Number.NaN, rows: Number.NaN });

    expect(lastTerminal().resizes).toHaveLength(terminalResizes);
    expect(lastSocket().resizes).toHaveLength(socketResizes);
  });
});

describe('detachPane', () => {
  it('closes the socket, disposes the terminal and stops observing the container', async () => {
    const { attachPane, detachPane } = await loadRegistry();
    const container = aContainer({ width: '800px', height: '600px' });
    attachPane('session-a', container, 0);

    detachPane('session-a');

    expect(lastSocket().closed).toBe(true);
    expect(lastTerminal().disposed).toBe(true);
    expect(liveObservers()).toEqual([]);
  });

  it('makes the next attach build a new pane', async () => {
    const { attachPane, detachPane } = await loadRegistry();
    const container = aContainer({ width: '800px', height: '600px' });
    attachPane('session-a', container, 0);
    detachPane('session-a');

    attachPane('session-a', container, 0);

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeTerminal.instances).toHaveLength(2);
  });

  it('is a no-op for a session with no open pane', async () => {
    const { detachPane } = await loadRegistry();

    expect(() => detachPane('session-none')).not.toThrow();
  });
});

describe('a pane whose socket closed on its own', () => {
  it('is gone from the registry, so the next attach opens a fresh socket', async () => {
    const { attachPane } = await loadRegistry();
    const container = aContainer({ width: '800px', height: '600px' });
    attachPane('session-a', container, 0);
    const first = lastSocket();

    first.handlers.onClose(1000);
    attachPane('session-a', container, 0);

    expect(first.closed).toBe(true);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
