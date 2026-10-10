// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ILink, ILinkHandler, ILinkProvider } from '@xterm/xterm';
import type { PaneSize, PaneSocketHandlers } from '../api/paneSocket.js';
import { unicodeV11Provider } from './unicodeWidth.js';

// The registry is garden's one imperative escape hatch (docs/architecture.md §5.1): all it holds
// is the wiring between xterm, the fit addon, a ResizeObserver and a pane socket, and that wiring
// is what breaks. Standing each collaborator in for the real thing is what makes the wiring
// observable — the same reason `dockview-identity.test.ts` needs a DOM.

/** `createPane`'s one call site always registers and activates the same provider, so there is no
 *  mismatch for a fake to guard against — just a settable `activeVersion` to read back. */
class FakeUnicodeHandling {
  activeVersion = '';

  register(): void {}
}

/** Minimal stand-in for xterm's `IBufferLine`. Only `translateToString` is exercised by the
 *  registry, so that's all this needs. */
class FakeBufferLine {
  constructor(
    private readonly text: string,
    readonly isWrapped = false,
  ) {}
  translateToString(): string {
    return this.text;
  }
}

class FakeTerminal {
  static instances: FakeTerminal[] = [];
  element: HTMLElement | undefined;
  readonly resizes: PaneSize[] = [];
  disposed = false;
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | undefined;
  readonly unicode = new FakeUnicodeHandling();
  readonly loadedAddons: unknown[] = [];
  /** Registration order of the three link providers. xterm's Linkifier resolves overlapping
   *  matches by registration order (first registered wins) — this is what a registration-order
   *  regression would get backwards. */
  readonly linkRegistrationOrder: string[] = [];
  /** The providers registered via `registerLinkProvider`, in registration order, so a test can
   *  call `provideLinks` on one of them directly instead of only observing registration order. */
  readonly linkProviders: ILinkProvider[] = [];
  readonly linkHandler: ILinkHandler | undefined;
  private readonly bufferLines = new Map<number, FakeBufferLine>();
  readonly buffer = { active: { getLine: (n: number) => this.bufferLines.get(n) } };

  readonly fontSize: number | undefined;

  constructor(options?: { linkHandler?: ILinkHandler; fontSize?: number }) {
    this.linkHandler = options?.linkHandler;
    this.fontSize = options?.fontSize;
    FakeTerminal.instances.push(this);
  }
  loadAddon(addon: unknown): void {
    this.loadedAddons.push(addon);
    if (addon instanceof FakeWebLinksAddon) this.linkRegistrationOrder.push('web-links');
  }
  open(container: HTMLElement): void {
    this.element = document.createElement('div');
    container.appendChild(this.element);
  }
  registerLinkProvider(provider: ILinkProvider): void {
    this.linkProviders.push(provider);
    this.linkRegistrationOrder.push(
      this.linkProviders.length === 1 ? 'markdown-link' : 'path-line',
    );
  }
  /** Sets the text of a 0-based buffer row, as `provideLinks` (1-based line numbers) will read it
   *  back via `getLine(lineNumber - 1)`. */
  setLine(lineNumber0Based: number, text: string, isWrapped = false): void {
    this.bufferLines.set(lineNumber0Based, new FakeBufferLine(text, isWrapped));
  }
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

class FakeWebLinksAddon {
  constructor(readonly handler?: (event: MouseEvent, uri: string) => void) {}
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly resizes: PaneSize[] = [];
  readonly writes: string[] = [];
  closed = false;

  constructor(
    readonly initialSize: PaneSize,
    readonly handlers: PaneSocketHandlers,
  ) {
    FakeSocket.instances.push(this);
  }
  write(data: string): void {
    this.writes.push(data);
  }
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
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: FakeWebLinksAddon }));
vi.mock('../features/sidebar/repoListCache.js', () => ({
  refreshRepoList: () => Promise.resolve([]),
}));
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

/** The markdown-link provider is always the first one `createPane` registers (see the
 *  registration-order test below), so index 0 is stable rather than a magic number. */
function markdownLinkProvider(terminal: FakeTerminal): ILinkProvider {
  const provider = terminal.linkProviders[0];
  if (provider === undefined) throw new Error('no link provider was registered');
  return provider;
}

/** The path-line provider is always the second one `createPane` registers. */
function pathLineProvider(terminal: FakeTerminal): ILinkProvider {
  const provider = terminal.linkProviders[1];
  if (provider === undefined) throw new Error('no path-line provider was registered');
  return provider;
}

/** `provideLinks` resolves its callback synchronously in this registry, so this just captures
 *  that callback's argument instead of needing to await anything. */
function provideLinks(provider: ILinkProvider, lineNumber: number): ILink[] | undefined {
  let result: ILink[] | undefined;
  provider.provideLinks(lineNumber, (links) => {
    result = links;
  });
  return result;
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

  it('activates the Unicode width provider that matches tmux', async () => {
    const { attachPane } = await loadRegistry();

    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);

    expect(lastTerminal().unicode.activeVersion).toBe(unicodeV11Provider.version);
  });

  it('loads the web links addon so URLs render as clickable links', async () => {
    const { attachPane } = await loadRegistry();

    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);

    expect(lastTerminal().loadedAddons).toContainEqual(expect.any(FakeWebLinksAddon));
  });

  it('loads the web links addon on a pane created after the first', async () => {
    const { attachPane } = await loadRegistry();
    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);

    attachPane('session-b', aContainer({ width: '800px', height: '600px' }), 0);

    expect(lastTerminal().loadedAddons).toContainEqual(expect.any(FakeWebLinksAddon));
  });

  it('constructs a new pane at the configured terminal font size', async () => {
    const { attachPane } = await loadRegistry();
    const { useSettingsStore } = await import('../state/settingsStore.js');
    useSettingsStore.setState({ terminalFontSize: 18 });

    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);

    expect(lastTerminal().fontSize).toBe(18);
  });

  it('registers the markdown-link provider, then path:line, then the web links addon, so an overlapping match resolves to the most specific provider', async () => {
    const { attachPane } = await loadRegistry();

    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);

    expect(lastTerminal().linkRegistrationOrder).toEqual([
      'markdown-link',
      'path-line',
      'web-links',
    ]);
  });

  describe('path-line links', () => {
    async function clickLink(lineText: string): Promise<{
      text: string | undefined;
      requestOpenFile: Mock;
    }> {
      const { attachPane } = await loadRegistry();
      const { useLocalStore } = await import('../state/localStore.js');
      const { useSessionStore } = await import('../state/sessionStore.js');
      useSessionStore.setState({
        sessions: { 'session-a': { cwd: '/work/repo' } } as never,
      });
      const requestOpenFile = vi.fn();
      useLocalStore.setState({ requestOpenFile });
      attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
      const terminal = lastTerminal();
      terminal.setLine(0, lineText);
      const links = provideLinks(pathLineProvider(terminal), 1);
      links?.[0]?.activate(new MouseEvent('click'), links[0].text);
      return { text: links?.[0]?.text, requestOpenFile };
    }

    it('opens a bare path without a line', async () => {
      const { text, requestOpenFile } = await clickLink('edited src/foo.ts today');

      expect(text).toBe('src/foo.ts');
      await vi.waitFor(() =>
        expect(requestOpenFile).toHaveBeenCalledWith(
          { kind: 'session', sessionId: 'session-a' },
          'src/foo.ts',
          null,
        ),
      );
    });

    it('does not link a path-shaped fragment at the start of a wrapped row', async () => {
      const { attachPane } = await loadRegistry();
      attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
      const terminal = lastTerminal();
      terminal.setLine(0, 'ers/profile.json', true);

      expect(provideLinks(pathLineProvider(terminal), 1)).toBeUndefined();
    });

    it('opens a path:line link at its line', async () => {
      const { text, requestOpenFile } = await clickLink('at src/foo.ts:42');

      expect(text).toBe('src/foo.ts:42');
      await vi.waitFor(() =>
        expect(requestOpenFile).toHaveBeenCalledWith(
          { kind: 'session', sessionId: 'session-a' },
          'src/foo.ts',
          42,
        ),
      );
    });
  });

  it("opens a markdown link's url through openExternalLink when its label is activated", async () => {
    const { attachPane } = await loadRegistry();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
    const terminal = lastTerminal();
    terminal.setLine(0, 'see [the docs](https://example.com/) now');

    const links = provideLinks(markdownLinkProvider(terminal), 1);
    links?.[0]?.activate(new MouseEvent('click'), links[0].text);

    expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('never opens a markdown link whose url has a rejected scheme', async () => {
    const { attachPane } = await loadRegistry();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
    const terminal = lastTerminal();
    terminal.setLine(0, '[go](javascript:evil)');

    const links = provideLinks(markdownLinkProvider(terminal), 1);
    links?.[0]?.activate(new MouseEvent('click'), links[0].text);

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('opens a plain-URL link from the web links addon with explicit noopener and noreferrer', async () => {
    const { attachPane } = await loadRegistry();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
    const webLinksAddon = lastTerminal().loadedAddons.find(
      (addon): addon is FakeWebLinksAddon => addon instanceof FakeWebLinksAddon,
    );
    if (webLinksAddon?.handler === undefined) throw new Error('no web links handler registered');

    webLinksAddon.handler(new MouseEvent('click'), 'https://example.com/');

    expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });
});

describe('the OSC 8 link handler', () => {
  // xterm's OscLinkProvider reads `options.linkHandler` in exactly one place, so this is the
  // only structural path an OSC 8 URI can reach `window.open` through — neither WebLinksAddon
  // nor the path:line provider (tested above and via pathLineLinks.test.ts) read this option.
  // The accept/reject matrix for `normalizeLinkUrl` itself lives in hyperlinks.test.ts; this
  // test only needs to prove the wiring doesn't hand a hostile scheme straight to the browser.
  it('never opens a hostile javascript: OSC 8 link', async () => {
    const { attachPane } = await loadRegistry();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
    const linkHandler = lastTerminal().linkHandler;
    if (linkHandler === undefined) throw new Error('no linkHandler registered');

    linkHandler.activate(new MouseEvent('click'), 'javascript:alert(1)', {
      start: { x: 1, y: 1 },
      end: { x: 1, y: 1 },
    });

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe('the custom key event handler', () => {
  function keyHandler(): (event: KeyboardEvent) => boolean {
    const handler = lastTerminal().customKeyEventHandler;
    if (handler === undefined) throw new Error('no handler registered');
    return handler;
  }

  it('writes a literal newline to the pty and suppresses xterm for Shift+Enter', async () => {
    const { attachPane } = await loadRegistry();
    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });

    const handled = keyHandler()(event);

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(lastSocket().writes).toEqual(['\n']);
  });

  it('leaves plain Enter to xterm without writing to the pty', async () => {
    const { attachPane } = await loadRegistry();
    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });

    const handled = keyHandler()(event);

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(lastSocket().writes).toEqual([]);
  });

  it('suppresses the keyup that follows a Shift+Enter keydown without writing again', async () => {
    const { attachPane } = await loadRegistry();
    attachPane('session-a', aContainer({ width: '800px', height: '600px' }), 0);
    const event = new KeyboardEvent('keyup', { key: 'Enter', shiftKey: true });

    const handled = keyHandler()(event);

    expect(handled).toBe(false);
    expect(lastSocket().writes).toEqual([]);
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
