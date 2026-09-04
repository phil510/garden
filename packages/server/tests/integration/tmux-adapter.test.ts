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
} from '../../src/adapters/tmux.js';
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

        await killSession(target, 'alpha');
        await until(
          'alpha to be gone',
          () => listPanes(target),
          (list) => list.length === 0,
        );
        await expect(killSession(target, 'nope')).rejects.toBeInstanceOf(TmuxError);
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
      expect(panes.map((pane) => pane.session)).toEqual(['beta']);
    });
  });
});
