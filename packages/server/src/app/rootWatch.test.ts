import { describe, expect, it } from 'vitest';
import type { FsWatchPort } from './ports.js';
import { RootNotListedError } from './repoCatalog.js';
import { createRootWatches } from './rootWatch.js';

interface FakeHandle {
  readonly root: string;
  readonly onChange: () => void;
  closes: number;
}

function fakeWatcher() {
  const handles: FakeHandle[] = [];
  const port: FsWatchPort = {
    watch(root, onChange) {
      const handle: FakeHandle = { root, onChange, closes: 0 };
      handles.push(handle);
      return {
        close: () => {
          handle.closes += 1;
        },
      };
    },
  };
  return {
    port,
    handles,
    openRoots: () => handles.filter((h) => h.closes === 0).map((h) => h.root),
  };
}

const logger = { warn: () => undefined, error: () => undefined };

/** Lists `/repo/a` and `/repo/b`, resolving them to `/real/a` and `/real/b`. */
const listedRepos = {
  resolveRoot: (root: string) => {
    const name = root.replace(/\/$/, '').split('/').pop()!;
    return ['a', 'b'].includes(name)
      ? Promise.resolve(`/real/${name}`)
      : Promise.reject(new RootNotListedError('not listed'));
  },
};

function setup(repos: { resolveRoot(root: string): Promise<string> } = listedRepos) {
  const watcher = fakeWatcher();
  const roots = createRootWatches({ watcher: watcher.port, repos, logger });
  const changes: string[] = [];
  const connection = roots.connect((root) => changes.push(root));
  return { watcher, connection, changes };
}

describe('createRootWatches', () => {
  it('swaps the connection watch when a new root arrives', async () => {
    const { watcher, connection } = setup();

    await connection.watch('/repo/a');
    await connection.watch('/repo/b');

    expect(watcher.handles.map((h) => [h.root, h.closes])).toEqual([
      ['/real/a', 1],
      ['/real/b', 0],
    ]);
  });

  it('releases the watch when the connection closes', async () => {
    const { watcher, connection } = setup();
    await connection.watch('/repo/a');

    connection.close();

    expect(watcher.openRoots()).toEqual([]);
  });

  it('establishes no watch for an unlisted root, and drops the previous one', async () => {
    const { watcher, connection } = setup();
    await connection.watch('/repo/a');

    await expect(connection.watch('/elsewhere')).resolves.toBeUndefined();

    expect(watcher.handles).toHaveLength(1);
    expect(watcher.openRoots()).toEqual([]);
  });

  it('leaves only the newest root open when an earlier resolve finishes late', async () => {
    let finishA!: (resolved: string) => void;
    const { watcher, connection } = setup({
      resolveRoot: (root) =>
        root === '/repo/a'
          ? new Promise((resolve) => {
              finishA = resolve;
            })
          : Promise.resolve('/real/b'),
    });

    const slow = connection.watch('/repo/a');
    await connection.watch('/repo/b');
    finishA('/real/a');
    await slow;

    expect(watcher.openRoots()).toEqual(['/real/b']);
    expect(watcher.handles).toHaveLength(1);
  });

  it('leaves no watch open when the connection closes while a resolve is pending', async () => {
    let finish!: (resolved: string) => void;
    const { watcher, connection } = setup({
      resolveRoot: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });

    const pending = connection.watch('/repo/a');
    connection.close();
    finish('/real/a');
    await pending;

    expect(watcher.handles).toEqual([]);
  });

  it('reports a change under the root spelling the client sent, not the resolved path', async () => {
    const { watcher, connection, changes } = setup();

    await connection.watch('/repo/a/');
    watcher.handles[0]!.onChange();

    expect(watcher.handles[0]!.root).toBe('/real/a');
    expect(changes).toEqual(['/repo/a/']);
  });

  it('establishes no watch when the root vanishes between resolve and watch', async () => {
    const warnings: string[] = [];
    const roots = createRootWatches({
      watcher: {
        watch: () => {
          throw new Error('ENOENT');
        },
      },
      repos: listedRepos,
      logger: { warn: (m) => warnings.push(m), error: () => undefined },
    });
    const connection = roots.connect(() => undefined);

    await expect(connection.watch('/repo/a')).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
  });
});
