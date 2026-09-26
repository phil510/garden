import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_STATE } from '../../src/adapters/store.js';
import {
  killSession,
  listPanes,
  newSession,
  respawnPane,
  type TmuxTarget,
} from '../../src/adapters/tmux.js';
import type { OverlayState, StorePort, TmuxPort } from '../../src/app/ports.js';
import { createProjection } from '../../src/app/projection.js';
import { createSession } from '../../src/app/sessions.js';
import { until } from './support/poll.js';
import { sessionEnv, withTmuxServer } from './support/tmux-server.js';

// A long-lived, harmless pane: createSession appends --session-id/--settings flags after
// whatever readClaudeCommand returns, and `sh -c '<script>' <extra args...>` takes those as
// positional parameters rather than folding them into the script text, so they're silently
// ignored here.
const sleeper = ['sh', '-c', 'sleep 30'];

function fakeStore(): StorePort {
  let current: OverlayState = DEFAULT_OVERLAY_STATE;
  return {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
}

function tmuxPort(target: TmuxTarget): TmuxPort {
  return {
    listPanes: () => listPanes(target),
    newSession: (request) => newSession(target, request),
    respawnPane: (request) => respawnPane(target, request),
    killSession: (name) => killSession(target, name),
  };
}

describe('spawn provenance', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('injects GARDEN_SESSION_ID into the pane environment on create', async () => {
    await withTmuxServer(async (target) => {
      const cwd = mkdtempSync(join(tmpdir(), 'garden-spawn-'));
      dirs.push(cwd);
      const projection = createProjection(fakeStore());

      const { id, tmuxName } = await createSession(
        {
          tmux: tmuxPort(target),
          store: fakeStore(),
          projection,
          serverPort: 4310,
          settingsPath: '/nonexistent/claude-settings.json',
          readClaudeCommand: () => sleeper,
        },
        { cwd },
      );

      await until(
        'the new pane to be listed',
        () => listPanes(target),
        (list) => list.length === 1,
      );
      expect(await sessionEnv(target, tmuxName, 'GARDEN_SESSION_ID')).toBe(id);
    });
  });

  it("records the caller as parent and creates a swarm for the caller's first child", async () => {
    await withTmuxServer(async (target) => {
      const callerCwd = mkdtempSync(join(tmpdir(), 'garden-spawn-caller-'));
      const childCwd = mkdtempSync(join(tmpdir(), 'garden-spawn-child-'));
      dirs.push(callerCwd, childCwd);
      const projection = createProjection(fakeStore());
      const deps = {
        tmux: tmuxPort(target),
        store: fakeStore(),
        projection,
        serverPort: 4310,
        settingsPath: '/nonexistent/claude-settings.json',
        readClaudeCommand: () => sleeper,
      };

      const caller = await createSession(deps, { cwd: callerCwd });
      const child = await createSession(deps, {
        cwd: childCwd,
        callerSessionId: caller.id,
      });

      expect(child.unknownCaller).toBeUndefined();
      const uiState = projection.uiState();
      expect(uiState.placements[child.id]).toEqual({ parent: caller.id });
      expect(uiState.swarms).toHaveLength(1);
      const swarm = uiState.swarms[0]!;
      expect(uiState.placements[caller.id]).toEqual({ swarmId: swarm.id });
    });
  });

  it('places a second child under the same caller without minting a second swarm', async () => {
    await withTmuxServer(async (target) => {
      const callerCwd = mkdtempSync(join(tmpdir(), 'garden-spawn-caller-'));
      const firstChildCwd = mkdtempSync(join(tmpdir(), 'garden-spawn-child1-'));
      const secondChildCwd = mkdtempSync(join(tmpdir(), 'garden-spawn-child2-'));
      dirs.push(callerCwd, firstChildCwd, secondChildCwd);
      const projection = createProjection(fakeStore());
      const deps = {
        tmux: tmuxPort(target),
        store: fakeStore(),
        projection,
        serverPort: 4310,
        settingsPath: '/nonexistent/claude-settings.json',
        readClaudeCommand: () => sleeper,
      };

      const caller = await createSession(deps, { cwd: callerCwd });
      await createSession(deps, { cwd: firstChildCwd, callerSessionId: caller.id });
      const secondChild = await createSession(deps, {
        cwd: secondChildCwd,
        callerSessionId: caller.id,
      });

      const uiState = projection.uiState();
      expect(uiState.swarms).toHaveLength(1);
      expect(uiState.placements[secondChild.id]).toEqual({ parent: caller.id });
    });
  });

  it('still succeeds, with no placement written, when the forwarded caller id is unknown', async () => {
    await withTmuxServer(async (target) => {
      const cwd = mkdtempSync(join(tmpdir(), 'garden-spawn-unknown-'));
      dirs.push(cwd);
      const projection = createProjection(fakeStore());

      const result = await createSession(
        {
          tmux: tmuxPort(target),
          store: fakeStore(),
          projection,
          serverPort: 4310,
          settingsPath: '/nonexistent/claude-settings.json',
          readClaudeCommand: () => sleeper,
        },
        { cwd, callerSessionId: 'no-such-session' },
      );

      expect(result.unknownCaller).toBe(true);
      const uiState = projection.uiState();
      expect(uiState.placements[result.id]).toBeUndefined();
      expect(uiState.swarms).toEqual([]);
      await until(
        'the spawn to have produced a live pane regardless of the unknown caller',
        () => listPanes(target),
        (list) => list.length === 1,
      );
    });
  });
});
