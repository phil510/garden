import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { listPanes, newSession } from '../../packages/server/src/adapters/tmux.js';
import {
  DEFAULT_OVERLAY_STATE,
  readOverlayState,
  writeOverlayState,
} from '../../packages/server/src/adapters/store.js';
import { loadConfig, readConfigFile } from '../../packages/server/src/config.js';
import { withTmuxServer } from './support/tmux-server.js';

const execFileAsync = promisify(execFile);
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const loader = join(repo, 'node_modules/tsx/dist/loader.mjs');
const cli = join(repo, 'packages/server/bin/garden.ts');

// Only the API needed by ls and stop: no harness executable or user state is involved.
async function withApi(
  id: string,
  fn: (server: { pid: number; port: number }) => Promise<void>,
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
    server.listen(0, '127.0.0.1', () => process.send(server.address().port));
  `,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  try {
    const [port] = (await once(child, 'message')) as unknown[];
    if (typeof port !== 'number' || child.pid === undefined) throw new Error('API failed to start');
    await fn({ pid: child.pid, port });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
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
  it.each(['stop', 'stop --all'])('%s and ls affect only the selected harness', async (stop) => {
    const home = mkdtempSync(join(tmpdir(), 'garden-instance-selection-'));
    try {
      await withTmuxServer(async (claudeTarget) =>
        withTmuxServer(async (codexTarget) => {
          await withApi('claude-session', async (claude) =>
            withApi('codex-session', async (codex) => {
              for (const [app, server, target] of [
                ['.garden-claude', claude, claudeTarget],
                ['.garden-codex', codex, codexTarget],
              ] as const) {
                const appDir = join(home, app);
                mkdirSync(appDir);
                writeFileSync(join(appDir, 'config.json'), JSON.stringify({ port: server.port }));
                writeFileSync(
                  join(appDir, 'server.pid'),
                  `${String(server.pid)}\n${String(server.port)}\n`,
                );
                await newSession(target, {
                  name: 'session',
                  cwd: home,
                  port: server.port,
                  sessionId: app,
                  command: ['sh', '-c', 'sleep 30'],
                });
              }
              const run = (harness: 'claude' | 'codex', args: string[]) => {
                const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
                // The test owns every resource it can address, regardless of its caller's instance.
                for (const name of [
                  'GARDEN_HARNESS',
                  'GARDEN_PORT',
                  'GARDEN_APP_DIR',
                  'GARDEN_TMUX_SOCKET',
                ]) {
                  delete env[name];
                }
                if (harness === 'codex') env.GARDEN_HARNESS = 'codex';
                env.GARDEN_TMUX_SOCKET = (harness === 'codex' ? codexTarget : claudeTarget).socket;
                return execFileAsync(process.execPath, ['--import', loader, cli, ...args], {
                  env,
                  timeout: 15_000,
                });
              };
              expect(JSON.parse((await run('claude', ['ls', '--json'])).stdout)).toMatchObject([
                { id: 'claude-session' },
              ]);
              expect(JSON.parse((await run('codex', ['ls', '--json'])).stdout)).toMatchObject([
                { id: 'codex-session' },
              ]);
              await run('codex', [...stop.split(' '), '--yes']);
              await expect(run('codex', ['ls', '--json'])).rejects.toThrow();
              expect(JSON.parse((await run('claude', ['ls', '--json'])).stdout)).toMatchObject([
                { id: 'claude-session' },
              ]);
              expect(await listPanes(claudeTarget)).toHaveLength(1);
              expect(await listPanes(codexTarget)).toHaveLength(stop === 'stop --all' ? 0 : 1);
              await run('claude', [...stop.split(' '), '--yes']);
              await expect(run('claude', ['ls', '--json'])).rejects.toThrow();
              expect(await listPanes(claudeTarget)).toHaveLength(stop === 'stop --all' ? 0 : 1);
            }),
          );
        }),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
