import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
import { resumeSession } from '../../src/app/sessions.js';
import { until } from './support/poll.js';
import { withTmuxServer } from './support/tmux-server.js';

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

describe('resuming a session against real tmux', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('respawns in place, keeping the tmux name, when tmux still holds the session', async () => {
    await withTmuxServer(async (target) => {
      const cwd = mkdtempSync(join(tmpdir(), 'garden-resume-'));
      dirs.push(cwd);
      const tmuxName = basename(cwd);
      const id = randomUUID();

      await newSession(target, {
        name: tmuxName,
        cwd,
        port: 4310,
        command: ['sh', '-c', 'exit 4'],
      });
      await until(
        'the seeded pane to be reported dead',
        () => listPanes(target),
        (list) => list[0]?.dead === true,
      );

      const projection = createProjection(fakeStore());
      projection.dispatch({ type: 'session-registered', id, tmuxName, cwd });

      const result = await resumeSession(
        {
          tmux: tmuxPort(target),
          store: fakeStore(),
          projection,
          serverPort: 4310,
          settingsPath: '/nonexistent/claude-settings.json',
        },
        { id },
      );

      expect(result).toEqual({ id, tmuxName });
      const panes = await until(
        'exactly one pane, still under the original name',
        () => listPanes(target),
        (list) => list.length === 1,
      );
      expect(panes[0]?.session).toBe(tmuxName);
      expect(projection.sessions().find((s) => s.id === id)?.tmuxName).toBe(tmuxName);
    });
  });

  it('starts a fresh tmux session, with the session id unchanged, when tmux no longer holds it', async () => {
    await withTmuxServer(async (target) => {
      const cwd = mkdtempSync(join(tmpdir(), 'garden-resume-'));
      dirs.push(cwd);
      const staleTmuxName = basename(cwd);
      const id = randomUUID();

      const projection = createProjection(fakeStore());
      projection.dispatch({ type: 'session-registered', id, tmuxName: staleTmuxName, cwd });
      expect(await listPanes(target)).toEqual([]);

      const result = await resumeSession(
        {
          tmux: tmuxPort(target),
          store: fakeStore(),
          projection,
          serverPort: 4310,
          settingsPath: '/nonexistent/claude-settings.json',
        },
        { id },
      );

      expect(result.id).toBe(id);
      const panes = await until(
        'a fresh pane to appear',
        () => listPanes(target),
        (list) => list.length === 1,
      );
      expect(panes[0]?.session).toBe(result.tmuxName);
      expect(projection.sessions().find((s) => s.id === id)?.tmuxName).toBe(result.tmuxName);
    });
  });
});
