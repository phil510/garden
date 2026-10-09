// Dev screenshot tool: drives an already-running garden through Chrome DevTools
// Protocol so an agent can look at its own UI changes. Zero new dependencies —
// Node 22's global `fetch` and `WebSocket` do the CDP round trip.
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// GARDEN_PORT targets the garden server (defaults to its own default port); CDP_PORT is
// Chrome's fixed remote-debugging port and is unrelated to which garden instance is targeted.
const SERVER_URL = `http://127.0.0.1:${process.env.GARDEN_PORT ?? 4310}`;
const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

interface Options {
  path: string;
  out: string;
  width: number;
  height: number;
  wait: number;
  drag?: string;
  dragBy?: { dx: number; dy: number };
}

function fail(message: string): never {
  console.error(`[screenshot] ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { path: '/', out: 'screenshot', width: 1600, height: 1000, wait: 300 };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) fail(`${String(flag)} needs a value`);
    if (flag === '--path') opts.path = value;
    else if (flag === '--out') opts.out = value;
    else if (flag === '--width') opts.width = Number(value);
    else if (flag === '--height') opts.height = Number(value);
    else if (flag === '--wait') opts.wait = Number(value);
    else if (flag === '--drag') opts.drag = value;
    else if (flag === '--drag-by') {
      const [dx, dy] = value.split(',').map(Number);
      if (dx === undefined || dy === undefined || Number.isNaN(dx) || Number.isNaN(dy)) {
        fail('--drag-by expects <dx>,<dy>, e.g. --drag-by 120,0');
      }
      opts.dragBy = { dx, dy };
    } else fail(`unknown flag ${String(flag)}`);
  }
  if ((opts.drag === undefined) !== (opts.dragBy === undefined)) {
    fail('--drag and --drag-by must be given together');
  }
  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probe(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitUntil(check: () => Promise<boolean>, label: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(250);
  }
}

/** Each checkout gets its own port, so a dev server found already listening is always
 *  serving the code under this worktree rather than another one's. GARDEN_PORT is folded
 *  into the hash too: vite.config.ts's proxy target is fixed at vite spawn time, so two
 *  runs in the same checkout with different GARDEN_PORT values must not reuse one vite. */
function vitePort(repoRoot: string): number {
  const key = `${repoRoot}:${process.env.GARDEN_PORT ?? 4310}`;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  return 5200 + hash;
}

async function ensureVite(repoRoot: string, viteUrl: string, port: number): Promise<void> {
  if (await probe(viteUrl)) return;
  console.log(`[screenshot] starting vite dev server on ${String(port)}...`);
  const logPath = join(repoRoot, '.screenshots', 'vite.log');
  mkdirSync(dirname(logPath), { recursive: true });
  const log = openSync(logPath, 'w');
  // --host pins the bind to IPv4: vite otherwise listens on [::1] only, which the
  // readiness probe and Chrome both reach for at 127.0.0.1 and never find.
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@garden/web',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: repoRoot, detached: true, stdio: ['ignore', log, log] },
  );
  child.unref();
  await waitUntil(
    () => probe(viteUrl),
    `vite dev server on ${String(port)} (see ${logPath})`,
    30_000,
  );
}

async function ensureChrome(): Promise<void> {
  if (await probe(`${CDP_URL}/json/version`)) return;
  console.log('[screenshot] launching debuggable Chrome...');
  // Chrome refuses remote debugging on the default profile, so a separate
  // --user-data-dir is required; it also keeps this instance isolated from
  // the user's own Chrome and their running garden window.
  const profileDir = join(tmpdir(), 'garden-screenshot-chrome-profile');
  await execFileAsync('open', [
    '-na',
    'Google Chrome',
    '--args',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--app=about:blank',
  ]);
  await waitUntil(() => probe(`${CDP_URL}/json/version`), 'Chrome CDP endpoint on 9222', 20_000);
}

interface CdpTarget {
  id: string;
  webSocketDebuggerUrl: string;
}

/** Every run drives a tab of its own, so whatever else is open in this Chrome is never the
 *  capture target. */
async function createTab(): Promise<CdpTarget> {
  const created = (await (
    await fetch(`${CDP_URL}/json/new?about:blank`, { method: 'PUT' })
  ).json()) as CdpTarget;
  if (!created.webSocketDebuggerUrl) throw new Error('Chrome would not open a new page target');
  return created;
}

interface Point {
  x: number;
  y: number;
}

async function captureScreenshot(url: string, opts: Options): Promise<Buffer> {
  const page = await createTab();
  let ws: WebSocket | undefined;
  try {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    const socket = ws;
    await new Promise<void>((resolvePromise, rejectPromise) => {
      socket.addEventListener('open', () => resolvePromise(), { once: true });
      socket.addEventListener('error', () => rejectPromise(new Error('CDP websocket error')), {
        once: true,
      });
    });

    let nextId = 0;
    const pending = new Map<
      number,
      { resolve: (result: unknown) => void; reject: (error: Error) => void }
    >();
    const eventWaiters = new Map<string, () => void>();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (message.error) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result);
        pending.delete(message.id);
      } else if (message.method !== undefined) {
        eventWaiters.get(message.method)?.();
        eventWaiters.delete(message.method);
      }
    });

    function send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      const id = ++nextId;
      return new Promise((resolvePromise, rejectPromise) => {
        pending.set(id, {
          resolve: resolvePromise as (result: unknown) => void,
          reject: rejectPromise,
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }

    function waitForEvent(method: string): Promise<void> {
      return new Promise((resolvePromise) => eventWaiters.set(method, resolvePromise));
    }

    function mouse(type: string, point: Point, buttons: number, clickCount = 0) {
      return send('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: buttons === 0 && type !== 'mouseReleased' ? 'none' : 'left',
        buttons,
        clickCount,
      });
    }

    /** Presses on the element's centre, moves in steps, releases: real input, so the app's
     *  own pointer handlers (and any clamping they do) decide where it ends up. */
    async function drag(selector: string, dx: number, dy: number): Promise<void> {
      const { result, exceptionDetails } = await send<{
        result: { value: Point | null };
        exceptionDetails?: { text: string; exception?: { description?: string } };
      }>('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
          return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
        })()`,
      });
      if (exceptionDetails) {
        throw new Error(
          `--drag ${selector}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
        );
      }
      const from = result.value;
      if (!from) throw new Error(`no element matches --drag ${selector}`);
      const to = { x: from.x + dx, y: from.y + dy };

      await mouse('mouseMoved', from, 0);
      await mouse('mousePressed', from, 1, 1);
      const steps = 10;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        await mouse('mouseMoved', { x: from.x + dx * t, y: from.y + dy * t }, 1);
      }
      await mouse('mouseReleased', to, 0, 1);
      console.log(
        `[screenshot] dragged ${selector} from ${String(from.x)},${String(from.y)} ` +
          `to ${String(to.x)},${String(to.y)}`,
      );
    }

    await send('Emulation.setDeviceMetricsOverride', {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.enable');
    const loaded = waitForEvent('Page.loadEventFired');
    await send('Page.navigate', { url });
    await Promise.race([loaded, sleep(10_000)]);
    await sleep(opts.wait);
    if (opts.drag !== undefined && opts.dragBy !== undefined) {
      await drag(opts.drag, opts.dragBy.dx, opts.dragBy.dy);
      await sleep(opts.wait);
    }
    const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  } finally {
    ws?.close();
    await fetch(`${CDP_URL}/json/close/${page.id}`).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  if (!(await probe(`${SERVER_URL}/health`))) {
    console.error(
      `garden is not answering on ${SERVER_URL}. Start garden first, then re-run ` +
        '`pnpm screenshot`. Note a config-file `port` override (distinct from GARDEN_PORT) ' +
        'is not read here, and looks identical to a stopped server.',
    );
    process.exit(1);
  }
  console.log(`[screenshot] garden server ok on ${SERVER_URL}`);

  const port = vitePort(repoRoot);
  const viteUrl = `http://127.0.0.1:${String(port)}`;
  await ensureVite(repoRoot, viteUrl, port);
  console.log(`[screenshot] vite dev server ok on ${String(port)}`);

  const targetUrl = `${viteUrl}${opts.path}`;
  await ensureChrome();
  console.log('[screenshot] debuggable Chrome ok on 9222');

  const png = await captureScreenshot(targetUrl, opts);

  const screenshotsDir = join(repoRoot, '.screenshots');
  mkdirSync(screenshotsDir, { recursive: true });
  const outPath = join(screenshotsDir, `${opts.out}.png`);
  writeFileSync(outPath, png);

  console.log(outPath);
}

main().catch((error: unknown) => {
  console.error(`[screenshot] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
