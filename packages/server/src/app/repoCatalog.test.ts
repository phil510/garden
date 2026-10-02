import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitPort } from './ports.js';
import { REPO_CACHE_TTL_MS, RootNotListedError, createRepoCatalog } from './repoCatalog.js';

interface FakeGit extends Pick<GitPort, 'repoRoot' | 'branch'> {
  readonly repoRootCalls: () => number;
}

/** A directory is a repo while it has a `.git` entry on disk, and `repoRoot` reports its
 *  realpath the way `git rev-parse` does. `gate` holds every `repoRoot` call until released,
 *  so a scan can be kept in flight. */
function fakeGit(options: { gate?: Promise<void> } = {}): FakeGit {
  let calls = 0;
  return {
    repoRootCalls: () => calls,
    repoRoot: async (cwd) => {
      calls += 1;
      await options.gate;
      try {
        realpathSync(join(cwd, '.git'));
        return realpathSync(cwd);
      } catch {
        throw new Error(`not a git repository: ${cwd}`);
      }
    },
    branch: () => Promise.resolve('main'),
  };
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('createRepoCatalog', () => {
  let dir: string;
  let repoA: string;
  let other: string;

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-catalog-')));
    repoA = join(dir, 'repoA');
    other = join(dir, 'other');
    mkdirSync(join(repoA, '.git'), { recursive: true });
    mkdirSync(other);
  }

  it('rejects a relative root without scanning', async () => {
    setup();
    const git = fakeGit();
    const catalog = createRepoCatalog({ git, roots: [dir] });

    await expect(catalog.resolveRoot('repoA')).rejects.toBeInstanceOf(RootNotListedError);
    expect(git.repoRootCalls()).toBe(0);
  });

  it('shares one scan between overlapping refreshes', async () => {
    setup();
    const git = fakeGit();
    const catalog = createRepoCatalog({ git, roots: [dir] });

    await Promise.all([catalog.list(), catalog.list(), catalog.resolveRoot(repoA)]);

    expect(git.repoRootCalls()).toBe(1); // only repoA has a `.git`, so one candidate is checked
  });

  it('holds a miss until the pending scan completes instead of deciding early', async () => {
    setup();
    const gate = deferred();
    const catalog = createRepoCatalog({ git: fakeGit({ gate: gate.promise }), roots: [dir] });

    mkdirSync(join(other, '.git'));
    let settled = false;
    const misses = [catalog.resolveRoot(other), catalog.resolveRoot(other)].map((miss) =>
      miss.finally(() => {
        settled = true;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    gate.release();

    // `other` qualifies once scanned, so this also shows the miss waited for the scan.
    for (const miss of misses) await expect(miss).resolves.toBe(other);
  });

  it('accepts a repo created after the cache was built, on the miss refresh', async () => {
    setup();
    const catalog = createRepoCatalog({ git: fakeGit(), roots: [dir] });
    await catalog.resolveRoot(repoA);

    mkdirSync(join(other, '.git'));

    await expect(catalog.resolveRoot(other)).resolves.toBe(other);
  });

  it('bounds a removal by the TTL from the start of the scan that listed it', async () => {
    setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    const gate = deferred();
    const git = fakeGit({ gate: gate.promise });
    const catalog = createRepoCatalog({ git, roots: [dir] });
    const scan = catalog.list();
    // The scan is held at its git check; the repo stops qualifying after that check ran.
    // Not vi.waitFor: it advances the faked clock while polling.
    while (git.repoRootCalls() === 0) await new Promise((resolve) => setImmediate(resolve));
    vi.setSystemTime(Date.now() + REPO_CACHE_TTL_MS - 1);
    gate.release();
    await scan;
    rmSync(join(repoA, '.git'), { recursive: true });

    // The snapshot dates from the scan's start, so it is nearly expired though just finished.
    await expect(catalog.resolveRoot(repoA)).resolves.toBe(repoA);
    vi.setSystemTime(Date.now() + 2);
    await expect(catalog.resolveRoot(repoA)).rejects.toBeInstanceOf(RootNotListedError);
  });

  it('rescans once past the TTL rather than trusting the old set', async () => {
    setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    const catalog = createRepoCatalog({ git: fakeGit(), roots: [dir] });
    await catalog.resolveRoot(repoA);

    rmSync(join(repoA, '.git'), { recursive: true });
    vi.setSystemTime(Date.now() + REPO_CACHE_TTL_MS + 1);

    await expect(catalog.resolveRoot(repoA)).rejects.toBeInstanceOf(RootNotListedError);
  });
});
