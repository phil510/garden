import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TmuxError,
  killSession,
  listPanes,
  newSession,
  respawnPane,
  socketHasLivePanes,
} from '../../packages/server/src/adapters/tmux.js';
import { instanceEnvironment, loadConfig } from '../../packages/server/src/config.js';
import { until } from './support/poll.js';
import { withTmuxServer } from './support/tmux-server.js';

const sleeper = ['sh', '-c', 'sleep 30'];

describe('the tmux adapter', () => {
  it('creates a session in the given cwd with GARDEN_PORT in its environment', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'garden-cwd-'));
    try {
      await withTmuxServer(async (target) => {
        await newSession(target, {
          name: 'alpha',
          cwd,
          port: 4310,
          sessionId: 'alpha-id',
          command: ['sh', '-c', 'printenv GARDEN_PORT > port.txt; sleep 30'],
        });
        const panes = await until(
          'the new session to be listed',
          () => listPanes(target),
          (list) => list.length === 1,
        );
        expect(panes[0]).toEqual({ session: 'alpha', dead: false, exitCode: undefined });

        // Written relative to the pane's cwd, so this proves -c as well as -e.
        // readFileSync throws synchronously, so the read is wrapped in an async
        // closure — `Promise.resolve(readFileSync(...)).catch()` would not catch
        // it, since the throw happens before Promise.resolve is ever called.
        const written = await until(
          'the session command to write port.txt',
          () => {
            try {
              return Promise.resolve(readFileSync(join(cwd, 'port.txt'), 'utf8').trim());
            } catch {
              return Promise.resolve('');
            }
          },
          (text) => text !== '',
        );
        expect(written).toBe('4310');
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('pins the effective instance in new and respawned panes despite a stale tmux environment', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'garden-instance-env-'));
    try {
      await withTmuxServer(async (target) => {
        const config = loadConfig({
          GARDEN_HARNESS: 'codex',
          GARDEN_PORT: '49123',
          GARDEN_TMUX_SOCKET: target.socket,
          GARDEN_APP_DIR: join(cwd, 'app dir'),
        });
        const effective = { ...target, instanceEnv: instanceEnvironment(config) };
        const command = (file: string) => [
          process.execPath,
          '-e',
          `
          const fs = require('node:fs');
          const env = Object.fromEntries(${JSON.stringify([
            'GARDEN_HARNESS',
            'GARDEN_PORT',
            'GARDEN_TMUX_SOCKET',
            'GARDEN_APP_DIR',
            'GARDEN_SESSION_ID',
          ])}.map(key => [key, process.env[key]]));
          fs.writeFileSync(${JSON.stringify(file)}, JSON.stringify(env));
        `,
        ];
        await newSession(target, {
          name: 'stale',
          cwd,
          port: 1,
          sessionId: 'stale-id',
          command: sleeper,
        });
        await newSession(effective, {
          name: 'instance',
          cwd,
          port: config.port,
          sessionId: 'instance-id',
          command: command('created.json'),
        });
        const readEnvironment = async (file: string) =>
          until(
            `pane environment in ${file}`,
            () => {
              try {
                return Promise.resolve(
                  JSON.parse(readFileSync(join(cwd, file), 'utf8')) as unknown,
                );
              } catch {
                return Promise.resolve(null);
              }
            },
            (env) => env !== null,
          );
        const expected = { ...instanceEnvironment(config), GARDEN_SESSION_ID: 'instance-id' };
        expect(await readEnvironment('created.json')).toEqual(expected);
        await until(
          'instance pane to exit',
          () => listPanes(target),
          (list) => list.some((p) => p.session === 'instance' && p.dead),
        );
        const moved = { ...config, port: 49124, appDir: join(cwd, 'moved app dir') };
        await respawnPane(
          { ...target, instanceEnv: instanceEnvironment(moved) },
          {
            name: 'instance',
            command: command('resumed.json'),
          },
        );
        expect(await readEnvironment('resumed.json')).toEqual({
          ...instanceEnvironment(moved),
          GARDEN_SESSION_ID: 'instance-id',
        });
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('kills a session by name and fails with a TmuxError on an unknown name', async () => {
    await withTmuxServer(async (target) => {
      await newSession(target, {
        name: 'alpha',
        cwd: tmpdir(),
        port: 4310,
        sessionId: 'alpha-id',
        command: sleeper,
      });
      await newSession(target, {
        name: 'gamma',
        cwd: tmpdir(),
        port: 4310,
        sessionId: 'gamma-id',
        command: sleeper,
      });

      await killSession(target, 'alpha');
      const remaining = await until(
        'alpha to be gone',
        () => listPanes(target),
        (list) => list.length === 1,
      );
      expect(remaining.map((pane) => pane.session)).toEqual(['gamma']);

      // gamma keeps the server alive, so this exercises the unknown-session path
      // rather than the dead-socket path listPanes swallows.
      await expect(killSession(target, 'nope')).rejects.toBeInstanceOf(TmuxError);
      await expect(killSession(target, 'nope')).rejects.toThrow(/can't find session/);
    });
  });

  it('reports no sessions when nothing has started a server on the socket', async () => {
    await withTmuxServer(async (target) => {
      expect(await listPanes(target)).toEqual([]);
    });
  });

  it('brings a dead pane back to life in place with respawn-pane', async () => {
    await withTmuxServer(async (target) => {
      await newSession(target, {
        name: 'beta',
        cwd: tmpdir(),
        port: 4310,
        sessionId: 'beta-id',
        command: ['sh', '-c', 'exit 4'],
      });
      await until(
        'the pane to be reported dead',
        () => listPanes(target),
        (list) => list[0]?.dead === true,
      );

      await respawnPane(target, { name: 'beta', command: sleeper });

      const panes = await until(
        'the respawned pane to be reported live',
        () => listPanes(target),
        (list) => list[0]?.dead === false,
      );
      // exitCode must clear too: a stale pane_dead_status would keep reporting 4.
      expect(panes).toEqual([{ session: 'beta', dead: false, exitCode: undefined }]);
    });
  });

  describe('socketHasLivePanes', () => {
    it('reports false on a freshly-allocated socket nothing has touched yet', async () => {
      await withTmuxServer(async (target) => {
        expect(await socketHasLivePanes(target.socket)).toBe(false);
      });
    });

    it('reports true once a session has put a live pane on the socket', async () => {
      await withTmuxServer(async (target) => {
        await newSession(target, {
          name: 'alpha',
          cwd: tmpdir(),
          port: 4310,
          sessionId: 'alpha-id',
          command: sleeper,
        });
        await until(
          'the new session to be listed',
          () => listPanes(target),
          (list) => list.length === 1,
        );
        expect(await socketHasLivePanes(target.socket)).toBe(true);
      });
    });

    it('reports false when the only pane present is dead', async () => {
      await withTmuxServer(async (target) => {
        await newSession(target, {
          name: 'ephemeral',
          cwd: tmpdir(),
          port: 4310,
          sessionId: 'ephemeral-id',
          command: ['sh', '-c', 'exit 0'],
        });
        await until(
          'the pane to be reported dead',
          () => listPanes(target),
          (list) => list[0]?.dead === true,
        );
        expect(await socketHasLivePanes(target.socket)).toBe(false);
      });
    });
  });
});
