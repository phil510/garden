import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERLAY_STATE,
  readOverlayState,
  writeOverlayState,
} from '../../packages/server/src/adapters/store.js';
import { loadConfig, readConfigFile } from '../../packages/server/src/config.js';

const execFileAsync = promisify(execFile);
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const loader = join(repo, 'node_modules/tsx/dist/loader.mjs');
const cli = join(repo, 'packages/server/bin/garden.ts');

const harnesses = ['claude', 'codex'] as const;
type Harness = (typeof harnesses)[number];

interface Api {
  pid: number;
  port: number;
}

// Only the API needed by ls, stop and attach to a running instance.
async function withApi(
  id: string,
  env: NodeJS.ProcessEnv,
  fn: (server: Api) => Promise<void>,
): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createServer } from 'node:http';
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/health' ? { pid: process.pid }
        : { sessions: [{ id: ${JSON.stringify(id)}, liveness: 'live' }] }));
    });
    server.on('error', (error) => process.send(error.message, () => process.exit(1)));
    server.listen(0, '127.0.0.1', () => process.send(server.address().port));
  `,
    ],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env },
  );
  try {
    const [port] = (await once(child, 'message', {
      signal: AbortSignal.timeout(5000),
    })) as unknown[];
    if (typeof port !== 'number' || child.pid === undefined) {
      throw new Error('API failed to start: ' + String(port));
    }
    await fn({ pid: child.pid, port });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
}

interface Instance extends Api {
  appDir: string;
  socket: string;
}

async function withInstances(
  fn: (ctx: {
    instances: Record<Harness, Instance>;
    run: (args: string[], overrides?: NodeJS.ProcessEnv) => Promise<{ stdout: string }>;
    hasSession: (harness: Harness) => Promise<void>;
    serverRunning: (harness: Harness) => Promise<boolean>;
    opened: string;
  }) => Promise<void>,
): Promise<void> {
  // Both default socket names stay inside the test's own short Unix socket namespace.
  const home = mkdtempSync('/tmp/g-');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CODEX_HOME: join(home, '.codex'),
    TMUX_TMPDIR: home,
    PATH: `${home}:${process.env.PATH ?? ''}`,
  };
  for (const name of Object.keys(env)) {
    if (name.startsWith('GARDEN_')) delete env[name];
  }
  delete env.TMUX;
  delete env.NODE_OPTIONS;

  const tmux = (harness: Harness, ...args: string[]) =>
    execFileAsync('tmux', ['-L', `garden-${harness}`, ...args], { env, timeout: 5000 });
  const opened = join(home, 'opened');
  try {
    writeFileSync(join(home, 'open'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/opened"\n', {
      mode: 0o700,
    });
    await withApi('claude-session', env, async (claude) =>
      withApi('codex-session', env, async (codex) => {
        const setup = async (harness: Harness, server: Api): Promise<Instance> => {
          const appDir = join(home, `.garden-${harness}`);
          mkdirSync(appDir);
          writeFileSync(
            join(appDir, 'config.json'),
            JSON.stringify({ port: server.port, roots: [home] }),
          );
          writeFileSync(
            join(appDir, 'server.pid'),
            `${String(server.pid)}\n${String(server.port)}\n`,
          );
          writeFileSync(join(appDir, 'tmux.conf'), '');
          await tmux(
            harness,
            '-f',
            join(appDir, 'tmux.conf'),
            'new-session',
            '-d',
            '-s',
            'session',
            'exec sleep 120',
          );
          return { ...server, appDir, socket: `garden-${harness}` };
        };
        const instances = {
          claude: await setup('claude', claude),
          codex: await setup('codex', codex),
        };
        const run = (args: string[], overrides: NodeJS.ProcessEnv = {}) =>
          execFileAsync(process.execPath, ['--import', loader, cli, ...args], {
            env: { ...env, ...overrides },
            timeout: 15_000,
          });
        const hasSession = async (harness: Harness) => {
          await tmux(harness, 'has-session');
        };
        const serverRunning = (harness: Harness) =>
          tmux(harness, 'show-options', '-g').then(
            () => true,
            () => false,
          );
        await fn({ instances, run, hasSession, serverRunning, opened });
      }),
    );
  } finally {
    await Promise.all(harnesses.map((harness) => tmux(harness, 'kill-server').catch(() => {})));
    rmSync(home, { recursive: true, force: true });
  }
}

describe('CLI instance isolation', () => {
  it('reads copied Claude config and overlay while retaining the legacy state for rollback', () => {
    const home = mkdtempSync(join(tmpdir(), 'garden-migration-'));
    try {
      const legacy = join(home, '.garden');
      const destination = loadConfig({}, undefined, home).appDir;
      mkdirSync(legacy);
      mkdirSync(destination);
      const saved = {
        ...DEFAULT_OVERLAY_STATE,
        tmuxNames: { saved: 'old-pane' },
        ui: { ...DEFAULT_OVERLAY_STATE.ui, groupOrder: ['saved-project'] },
      };
      writeFileSync(
        join(legacy, 'config.json'),
        JSON.stringify({ roots: ['/saved'], port: 48123, claudeCommand: 'custom-claude' }),
      );
      writeOverlayState(legacy, saved);
      writeFileSync(join(legacy, 'server.pid'), 'obsolete runtime file');
      for (const file of ['config.json', 'state.json']) {
        copyFileSync(join(legacy, file), join(destination, file));
        expect(readFileSync(join(destination, file))).toEqual(readFileSync(join(legacy, file)));
      }
      const migrated = loadConfig({}, readConfigFile(join(destination, 'config.json')), home);
      expect(migrated).toMatchObject({
        appDir: join(home, '.garden-claude'),
        tmuxSocket: 'garden-claude',
        port: 48123,
        roots: ['/saved'],
      });
      expect(readConfigFile(join(destination, 'config.json')).claudeCommand).toBe('custom-claude');
      expect(readOverlayState(destination, { warn: () => {} })).toEqual(saved);
      writeOverlayState(destination, DEFAULT_OVERLAY_STATE);
      expect(readOverlayState(legacy, { warn: () => {} })).toEqual(saved);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('selects the HTTP instance for ls and bare startup, including inside a Garden pane', async () => {
    await withInstances(async ({ instances, run, opened }) => {
      const ls = ['ls', '--json'];
      expect(JSON.parse((await run(ls)).stdout)).toMatchObject([{ id: 'claude-session' }]);
      expect(JSON.parse((await run(ls, { GARDEN_HARNESS: 'codex' })).stdout)).toMatchObject([
        { id: 'codex-session' },
      ]);
      for (const [selected, ambient] of [
        ['claude', 'codex'],
        ['codex', 'claude'],
      ] as const) {
        const flag = `--${selected}`;
        const env = { GARDEN_HARNESS: ambient, GARDEN_SERVER_PROCESS: '1' };
        expect(JSON.parse((await run([flag, ...ls], env)).stdout)).toMatchObject([
          { id: `${selected}-session` },
        ]);
        rmSync(opened, { force: true });
        const { stdout } = await run([flag], env);
        const expectedUrl = `http://127.0.0.1:${String(instances[selected].port)}`;
        if (existsSync(opened)) {
          expect(readFileSync(opened, 'utf8').trim().split('\n')).toContain(`--app=${expectedUrl}`);
        } else {
          expect(stdout.trim()).toBe(expectedUrl);
        }
      }
    });
  });

  it('rejects conflicting flags before stopping either instance', async () => {
    await withInstances(async ({ run, hasSession }) => {
      for (const flags of [
        ['--claude', '--codex'],
        ['--codex', '--claude'],
      ]) {
        await expect(run([...flags, 'stop', '--all', '--yes'])).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringMatching(/cannot combine --claude and --codex/) as unknown,
        });
      }
      for (const harness of harnesses) {
        expect(JSON.parse((await run([`--${harness}`, 'ls', '--json'])).stdout)).toMatchObject([
          { id: `${harness}-session` },
        ]);
        await hasSession(harness);
      }
    });
  });

  it.each([
    { selected: 'codex', ambient: 'claude', command: 'stop', killsTmux: false },
    { selected: 'claude', ambient: 'codex', command: 'stop', killsTmux: false },
    { selected: 'codex', ambient: 'claude', command: 'stop --all', killsTmux: true },
    { selected: 'claude', ambient: 'codex', command: 'stop --all', killsTmux: true },
  ] as const)(
    '$command targets $selected even with $ambient in the environment',
    async ({ selected, ambient, command, killsTmux }) => {
      await withInstances(async ({ instances, run, hasSession, serverRunning }) => {
        const flag = `--${selected}`;
        const overrides = { GARDEN_HARNESS: ambient };
        const { stdout } = await run([flag, ...command.split(' '), '--yes'], overrides);
        expect(stdout).toContain('garden stopped');
        expect(existsSync(join(instances[selected].appDir, 'server.pid'))).toBe(false);
        await expect(run([flag, 'ls', '--json'], overrides)).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining('garden server is not running') as unknown,
        });
        expect(JSON.parse((await run(['ls', '--json'], overrides)).stdout)).toMatchObject([
          { id: `${ambient}-session` },
        ]);
        await hasSession(ambient);
        if (killsTmux) {
          await expect.poll(() => serverRunning(selected)).toBe(false);
        } else {
          await hasSession(selected);
        }
      });
    },
  );

  it('retains instance overrides even when a flag selects the other harness', async () => {
    await withInstances(async ({ instances, run, hasSession, serverRunning }) => {
      const { claude, codex } = instances;
      const env = {
        GARDEN_HARNESS: 'claude',
        GARDEN_APP_DIR: claude.appDir,
        GARDEN_TMUX_SOCKET: claude.socket,
        GARDEN_PORT: String(codex.port),
      };
      // The port override disagrees with the Claude config file in the overridden app dir.
      expect(JSON.parse((await run(['--codex', 'ls', '--json'], env)).stdout)).toMatchObject([
        { id: 'codex-session' },
      ]);
      const { stdout } = await run(['--codex', 'stop', '--all', '--yes'], {
        ...env,
        GARDEN_PORT: String(claude.port),
      });
      expect(stdout).toContain('garden stopped; tmux server killed');
      expect(existsSync(join(claude.appDir, 'server.pid'))).toBe(false);
      await expect.poll(() => serverRunning('claude')).toBe(false);
      expect(existsSync(join(codex.appDir, 'server.pid'))).toBe(true);
      await hasSession('codex');
    });
  });

  it('uninstalls only the instance selected by the flag', async () => {
    await withInstances(async ({ instances, run, hasSession, serverRunning }) => {
      const { stdout } = await run(['--codex', 'uninstall', '--yes'], { GARDEN_HARNESS: 'claude' });
      expect(stdout).toContain('garden uninstalled');
      expect(existsSync(instances.codex.appDir)).toBe(false);
      await expect.poll(() => serverRunning('codex')).toBe(false);
      expect(existsSync(join(instances.claude.appDir, 'server.pid'))).toBe(true);
      expect(JSON.parse((await run(['ls', '--json'])).stdout)).toMatchObject([
        { id: 'claude-session' },
      ]);
      await hasSession('claude');
    });
  });
});
