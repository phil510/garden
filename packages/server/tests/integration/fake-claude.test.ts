import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { SessionState } from '@garden/shared';
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
import { createProjection, type Projection } from '../../src/app/projection.js';
import { createSession } from '../../src/app/sessions.js';
import { createServer as createGardenServer } from '../../src/http/server.js';
import { until } from './support/poll.js';
import { withTmuxServer } from './support/tmux-server.js';

const execFileAsync = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const TSX = join(repoRoot, 'node_modules', '.bin', 'tsx');
const FAKE_CLAUDE = join(repoRoot, 'scripts', 'fake-claude.ts');

/** Printed by the fake once its read loop is attached; see scripts/fake-claude.ts. */
const READY_MARKER = '[fake-claude] READY';

/** The fake accepts and ignores --settings, so nothing has to exist at this path. */
const SETTINGS_PATH = '/nonexistent/claude-settings.json';

/**
 * GARDEN_PORT reaches the pane through tmux's own -e; GARDEN_TRANSCRIPTS_DIR has no such
 * channel, so `env` carries it rather than this process mutating its own environment — the
 * tmux server captured that at start and shares it with every pane on the socket.
 */
function fakeClaudeCommand(transcriptsDir: string): readonly string[] {
  return ['env', `GARDEN_TRANSCRIPTS_DIR=${transcriptsDir}`, TSX, FAKE_CLAUDE];
}

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

function unused(): never {
  throw new Error('not used by this test');
}

async function tmux(target: TmuxTarget, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', [
    '-L',
    target.socket,
    '-f',
    target.confPath,
    ...args,
  ]);
  return stdout;
}

/**
 * The server has no tmux poll of its own here, so liveness would stay stale and mask every
 * status to null. Re-deriving it inside the probe is what main.ts's interval does, minus the
 * timer; tmux lists panes rather than sessions, so the names are collapsed on the way in.
 */
function snapshotThenRead(
  projection: Projection,
  target: TmuxTarget,
  id: string,
): () => Promise<SessionState | undefined> {
  return async () => {
    const byName = new Map(
      (await listPanes(target)).map((pane) => [
        pane.session,
        { name: pane.session, paneDead: pane.dead, exitCode: pane.exitCode ?? null },
      ]),
    );
    projection.dispatch({ type: 'tmux-snapshot', sessions: [...byName.values()] });
    return projection.sessions().find((session) => session.id === id);
  };
}

describe('a real fake-claude process spawned into a tmux pane', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('drives its session through working, needs-approval, waiting and ended', async () => {
    await withTmuxServer(async (target) => {
      const cwd = mkdtempSync(join(tmpdir(), 'garden-fake-cwd-'));
      const transcriptsDir = mkdtempSync(join(tmpdir(), 'garden-fake-transcripts-'));
      dirs.push(cwd, transcriptsDir);

      const projection = createProjection(fakeStore());
      const store = fakeStore();
      const app = createGardenServer({
        projection,
        tmux: tmuxPort(target),
        store,
        git: {
          repoRoot: unused,
          branch: unused,
          status: unused,
          workTreePrefix: unused,
        },
        attach: { attach: unused },
        roots: [],
        serverPort: 0,
        settingsPath: SETTINGS_PATH,
        claudeCommand: fakeClaudeCommand(transcriptsDir),
      });

      try {
        await app.listen({ port: 0, host: '127.0.0.1' });
        const { port } = app.server.address() as AddressInfo;

        const { id, tmuxName } = await createSession(
          {
            tmux: tmuxPort(target),
            store,
            projection,
            serverPort: port,
            settingsPath: SETTINGS_PATH,
            claudeCommand: fakeClaudeCommand(transcriptsDir),
          },
          { cwd },
        );

        const read = snapshotThenRead(projection, target, id);

        // The banner and READY are the fake's own output, so waiting on them covers tsx's
        // cold start without a fixed sleep, and READY is printed only once stdin is attached.
        await until(
          'the fake to print its READY marker',
          () => tmux(target, ['capture-pane', '-p', '-t', tmuxName]),
          (pane) => pane.includes(READY_MARKER),
          30_000,
        );

        // SessionStart is awaited before READY prints, so this has already landed.
        expect((await read())?.status).toBe('working');

        for (const [keyword, status] of [
          ['/approve', 'needs-approval'],
          ['/wait', 'waiting'],
        ] as const) {
          await tmux(target, ['send-keys', '-t', tmuxName, keyword, 'Enter']);
          const session = await until(
            `${keyword} to move the session to ${status}`,
            read,
            (candidate) => candidate?.status === status,
          );
          expect(session?.liveness).toBe('live');
        }

        await tmux(target, ['send-keys', '-t', tmuxName, '/end', 'Enter']);
        // The SessionEnd hook lands while the pane is still up, so liveness reads dead before
        // there is any exit code. Waiting on the code instead pins both halves: the hook and
        // the process actually going away.
        const ended = await until(
          '/end to end the session and leave a dead pane carrying its exit code',
          read,
          (candidate) => candidate?.exitCode === 0,
        );
        expect(ended?.liveness).toBe('dead');
        // A dead session reports no status at all — SessionEnd is not itself a Status, and
        // domain/reduce.ts masks whatever the last one was once liveness is dead.
        expect(ended?.status).toBeNull();
      } finally {
        await app.close();
      }
    });
  });
});
