import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPipes } from '../../src/app/pipes.js';
import { createProjection } from '../../src/app/projection.js';
import { updateWatches } from '../../src/app/watches.js';
import { runEventsFollow } from '../../src/cli/events.js';
import type { WritableLike } from '../../src/cli/io.js';
import type { Watch } from '../../src/domain/watches.js';
import { createServer } from '../../src/http/server.js';
import { fakeStore } from './support/fakeStore.js';
import { noRootWatches } from './support/noRootWatches.js';
import { until } from './support/poll.js';

const SESSION = 'sess-1';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function aWatch(pendingDigest: Watch['pendingDigest']): Watch {
  return {
    id: 'w1',
    sessionId: SESSION,
    repo: 'acme/widgets',
    pr: 7,
    kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
    createdAt: Date.now(),
    cursor: null,
    pendingDigest,
    status: 'active',
  };
}

const notUsed = () => Promise.reject(new Error('not used by this test'));
const unusedGit = {
  repoRoot: notUsed,
  branch: notUsed,
  status: notUsed,
  workTreePrefix: notUsed,
  remoteUrl: notUsed,
};

describe('garden events --follow against the real server', () => {
  let home: string;
  let originalHome: string | undefined;
  let originalPort: string | undefined;
  let app: ReturnType<typeof createServer> | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'garden-pipe-home-'));
    originalHome = process.env.HOME;
    originalPort = process.env.GARDEN_PORT;
    process.env.HOME = home;
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalPort === undefined) delete process.env.GARDEN_PORT;
    else process.env.GARDEN_PORT = originalPort;
    rmSync(home, { recursive: true, force: true });
  });

  it('prints a digest, acks it, and keeps delivering across a server restart', async () => {
    const store = fakeStore();
    const port = await freePort();
    process.env.GARDEN_PORT = String(port);

    const boot = async () => {
      const projection = createProjection(store);
      const deps = { projection, git: { remoteUrl: () => Promise.resolve(null) } };
      const server = createServer({
        projection,
        pipes: createPipes(deps),
        repos: { list: () => Promise.resolve([]), resolveRoot: notUsed },
        serverPort: port,
        settingsPath: '/home/.garden/claude-settings.json',
        readClaudeCommand: () => ['claude'],
        deadSessionCap: 10,
        rootWatches: noRootWatches,
        tmux: {
          listPanes: notUsed,
          newSession: notUsed,
          respawnPane: notUsed,
          killSession: notUsed,
        },
        git: unusedGit,
        configPort: {
          read: () => {
            throw new Error('not used by this test');
          },
          write: () => {
            throw new Error('not used by this test');
          },
        },
        attach: {
          attach: () => {
            throw new Error('not used by this test');
          },
        },
      });
      await server.listen({ port, host: '127.0.0.1' });
      return { server, deps };
    };
    const seed = (deps: Awaited<ReturnType<typeof boot>>['deps'], id: string) =>
      updateWatches(
        deps,
        () => [aWatch({ id, line: `line ${id}`, createdAt: Date.now() })],
        Date.now(),
      );

    const printed: string[] = [];
    const out: WritableLike = {
      write(text, callback) {
        printed.push(text);
        callback?.();
      },
    };
    const stderr: WritableLike = { write: (_text, callback) => callback?.() };
    let resolveGone!: () => void;
    const gone = new Promise<void>((resolve) => {
      resolveGone = resolve;
    });
    let returned = false;

    const first = await boot();
    app = first.server;
    seed(first.deps, 'd1');
    const run = runEventsFollow({
      env: { GARDEN_SESSION_ID: SESSION, CLAUDE_CODE_SESSION_ID: SESSION },
      out,
      stderr,
      gone,
    });
    void run.then(() => {
      returned = true;
    });

    await until(
      'the first digest to be printed and acked',
      () => Promise.resolve(store.read().watches[0]?.pendingDigest ?? null),
      (pending) => printed.length === 1 && pending === null,
    );

    await app.close();
    const second = await boot();
    app = second.server;
    seed(second.deps, 'd2');

    await until(
      'the second digest to be printed and acked after the restart',
      () => Promise.resolve(store.read().watches[0]?.pendingDigest ?? null),
      (pending) => printed.length === 2 && pending === null,
    );

    expect(printed).toEqual(['line d1\n', 'line d2\n']);
    expect(returned).toBe(false);

    resolveGone();
    expect(await run).toBe(0);
  });
});
