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

const SERVER_URL = 'http://127.0.0.1:4310';
const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

interface Options {
  path: string;
  out: string;
  width: number;
  height: number;
  wait: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { path: '/', out: 'screenshot', width: 1600, height: 1000, wait: 300 };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--path' && value !== undefined) opts.path = value;
    else if (argv[i] === '--out' && value !== undefined) opts.out = value;
    else if (argv[i] === '--width' && value !== undefined) opts.width = Number(value);
    else if (argv[i] === '--height' && value !== undefined) opts.height = Number(value);
    else if (argv[i] === '--wait' && value !== undefined) opts.wait = Number(value);
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
 *  serving the code under this worktree rather than another one's. */
function vitePort(repoRoot: string): number {
  let hash = 0;
  for (const char of repoRoot) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
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

async function ensureChrome(url: string): Promise<void> {
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
    `--app=${url}`,
  ]);
  await waitUntil(() => probe(`${CDP_URL}/json/version`), 'Chrome CDP endpoint on 9222', 20_000);
}

interface CdpTarget {
  type: string;
  webSocketDebuggerUrl: string;
}

/** Closing Chrome's last window leaves the process (and so the CDP endpoint) alive with no
 *  page to drive, so a missing target means open one rather than give up. */
async function pageTarget(url: string): Promise<CdpTarget> {
  const targets = (await (await fetch(`${CDP_URL}/json/list`)).json()) as CdpTarget[];
  const existing = targets.find((target) => target.type === 'page');
  if (existing) return existing;

  const created = (await (
    await fetch(`${CDP_URL}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  ).json()) as CdpTarget;
  if (!created.webSocketDebuggerUrl) throw new Error('Chrome would not open a new page target');
  return created;
}

async function captureScreenshot(
  url: string,
  width: number,
  height: number,
  waitMs: number,
): Promise<Buffer> {
  const page = await pageTarget(url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    ws.addEventListener('open', () => resolvePromise(), { once: true });
    ws.addEventListener('error', () => rejectPromise(new Error('CDP websocket error')), {
      once: true,
    });
  });

  let nextId = 0;
  const pending = new Map<number, (result: unknown) => void>();
  const eventWaiters = new Map<string, () => void>();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      result?: unknown;
    };
    if (message.id !== undefined) {
      pending.get(message.id)?.(message.result);
      pending.delete(message.id);
    } else if (message.method !== undefined) {
      eventWaiters.get(message.method)?.();
      eventWaiters.delete(message.method);
    }
  });

  function send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++nextId;
    return new Promise((resolvePromise) => {
      pending.set(id, resolvePromise as (result: unknown) => void);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  function waitForEvent(method: string): Promise<void> {
    return new Promise((resolvePromise) => eventWaiters.set(method, resolvePromise));
  }

  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.enable');
  const loaded = waitForEvent('Page.loadEventFired');
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(10_000)]);
  await sleep(waitMs);
  const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  ws.close();
  return Buffer.from(data, 'base64');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  if (!(await probe(`${SERVER_URL}/health`))) {
    console.error(
      `garden is not answering on ${SERVER_URL}. Start garden first, then re-run ` +
        '`pnpm screenshot`. Note this assumes the default port: a custom GARDEN_PORT or ' +
        'config `port` is not read here, and looks identical to a stopped server.',
    );
    process.exit(1);
  }
  console.log('[screenshot] garden server ok on 4310');

  const port = vitePort(repoRoot);
  const viteUrl = `http://127.0.0.1:${String(port)}`;
  await ensureVite(repoRoot, viteUrl, port);
  console.log(`[screenshot] vite dev server ok on ${String(port)}`);

  const targetUrl = `${viteUrl}${opts.path}`;
  await ensureChrome(targetUrl);
  console.log('[screenshot] debuggable Chrome ok on 9222');

  const png = await captureScreenshot(targetUrl, opts.width, opts.height, opts.wait);

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
