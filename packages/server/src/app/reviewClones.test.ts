import type { RepoEntry } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { createCloneResolver } from './reviewClones.js';

const entry = (path: string, isWorktree = false): RepoEntry => ({
  path,
  name: path.split('/').pop() ?? path,
  branch: 'main',
  isWorktree,
});

/** A fake git keyed by directory: `remotes` maps a path to its origin URL, `bare` lists the bare
 *  repositories, and `failing` paths throw. `calls` counts every git call. */
function setup(
  entries: RepoEntry[],
  remotes: Record<string, string | null>,
  options: { bare?: string[]; failing?: Set<string>; catalogFails?: boolean } = {},
) {
  const state = { entries, calls: 0 };
  const failing = options.failing ?? new Set<string>();
  const resolver = createCloneResolver({
    git: {
      isBareRepository: (cwd) => {
        state.calls += 1;
        return failing.has(cwd)
          ? Promise.reject(new Error('git failed'))
          : Promise.resolve(options.bare?.includes(cwd) ?? false);
      },
      remoteUrl: (cwd) => {
        state.calls += 1;
        return Promise.resolve(remotes[cwd] ?? null);
      },
    },
    catalog: {
      list: () =>
        options.catalogFails === true
          ? Promise.reject(new Error('scan failed'))
          : Promise.resolve(state.entries),
    },
  });
  return { state, failing, resolver };
}

describe('createCloneResolver', () => {
  it('resolves a repo to the main checkout whose origin matches', async () => {
    const { resolver } = setup([entry('/r/widgets')], {
      '/r/widgets': 'git@github.com:Acme/Widgets.git',
    });
    expect((await resolver.resolve(['acme/widgets'])).get('acme/widgets')).toBe('/r/widgets');
  });

  it('ignores a worktree even when its origin matches', async () => {
    const { resolver } = setup([entry('/r/wt', true)], {
      '/r/wt': 'https://github.com/acme/widgets',
    });
    expect((await resolver.resolve(['acme/widgets'])).get('acme/widgets')).toBeNull();
  });

  it('ignores a bare clone', async () => {
    const { resolver } = setup(
      [entry('/r/bare')],
      { '/r/bare': 'https://github.com/acme/widgets' },
      { bare: ['/r/bare'] },
    );
    expect((await resolver.resolve(['acme/widgets'])).get('acme/widgets')).toBeNull();
  });

  it('resolves null when no clone matches, and for a clone with no origin', async () => {
    const { resolver } = setup([entry('/r/a'), entry('/r/b')], {
      '/r/a': 'https://github.com/acme/other',
      '/r/b': null,
    });
    expect((await resolver.resolve(['acme/widgets'])).get('acme/widgets')).toBeNull();
  });

  it('prefers the path that sorts first when several clones match', async () => {
    const { resolver } = setup([entry('/r/z'), entry('/r/a')], {
      '/r/z': 'https://github.com/acme/widgets',
      '/r/a': 'https://github.com/acme/widgets',
    });
    expect((await resolver.resolve(['acme/widgets'])).get('acme/widgets')).toBe('/r/a');
  });

  it('runs git only for paths it has not seen', async () => {
    const { resolver, state } = setup([entry('/r/a')], {
      '/r/a': 'https://github.com/acme/a',
      '/r/b': 'https://github.com/acme/b',
    });
    await resolver.resolve(['acme/a']);
    const afterFirst = state.calls;
    await resolver.resolve(['acme/a']);
    expect(state.calls).toBe(afterFirst);
    state.entries = [entry('/r/a'), entry('/r/b')];
    expect((await resolver.resolve(['acme/b'])).get('acme/b')).toBe('/r/b');
    expect(state.calls).toBeGreaterThan(afterFirst);
  });

  it('retries a path whose git call failed, without failing the others', async () => {
    const failing = new Set(['/r/a']);
    const { resolver, failing: live } = setup(
      [entry('/r/a'), entry('/r/b')],
      { '/r/a': 'https://github.com/acme/a', '/r/b': 'https://github.com/acme/b' },
      { failing },
    );
    const first = await resolver.resolve(['acme/a', 'acme/b']);
    expect(first.get('acme/a')).toBeNull();
    expect(first.get('acme/b')).toBe('/r/b');
    live.clear();
    expect((await resolver.resolve(['acme/a'])).get('acme/a')).toBe('/r/a');
  });

  it('resolves every repo to null when the catalog cannot be read', async () => {
    const { resolver } = setup([], {}, { catalogFails: true });
    expect([...(await resolver.resolve(['acme/a', 'acme/b']))]).toEqual([
      ['acme/a', null],
      ['acme/b', null],
    ]);
  });

  it('bounds concurrent git calls while still resolving every path', async () => {
    let active = 0;
    let peak = 0;
    const paths = Array.from({ length: 30 }, (_, i) => `/r/repo${i}`);
    const resolver = createCloneResolver({
      git: {
        isBareRepository: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return false;
        },
        remoteUrl: (cwd) => Promise.resolve(`https://github.com/acme/${cwd.split('/').pop()}`),
      },
      catalog: { list: () => Promise.resolve(paths.map((path) => entry(path))) },
    });
    const repos = paths.map((path) => `acme/${path.split('/').pop()}`);
    const resolved = await resolver.resolve(repos);
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
    expect(repos.every((repo) => resolved.get(repo) === `/r/${repo.split('/')[1]}`)).toBe(true);
  });
});
