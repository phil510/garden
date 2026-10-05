import type { Delta } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { Watch } from '../domain/watches.js';
import type { GitPort, OverlayState, StorePort } from './ports.js';
import { createProjection } from './projection.js';
import { SessionNotFoundError } from './sessions.js';
import {
  addWatch,
  AmbiguousWatchError,
  listWatches,
  RepoUnresolvedError,
  removeWatch,
  replayWatches,
  updateWatches,
  WatchNotFoundError,
} from './watches.js';

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
  swarms: [],
  placements: {},
  swarmOrder: [],
  collapsedSwarms: [],
  hideDeadSwarms: [],
  watches: [],
  digests: [],
  pipes: {},
};

const DAY_MS = 24 * 60 * 60 * 1000;

function aWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: 'w1',
    sessionId: 's1',
    repo: 'acme/widgets',
    pr: 7,
    kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
    createdAt: 1,
    cursor: null,
    pendingDigest: null,
    status: 'active',
    ...overrides,
  };
}

/** A real projection over an in-memory store, so what a test reads back is what a client would
 *  see. `writes` counts store writes. */
function setup(options: {
  watches?: readonly Watch[];
  sessions?: readonly string[];
  remoteUrl?: GitPort['remoteUrl'];
}) {
  let overlay: OverlayState = { ...emptyOverlay, watches: options.watches ?? [] };
  let writes = 0;
  const store: StorePort = {
    read: () => overlay,
    write: (state) => {
      overlay = state;
      writes += 1;
    },
  };
  const projection = createProjection(store);
  for (const id of options.sessions ?? ['s1'])
    projection.dispatch({ type: 'session-registered', id, tmuxName: id, cwd: `/work/${id}` });
  const deltas: Delta[] = [];
  projection.subscribe((batch) => deltas.push(...batch));
  const remoteUrls: string[] = [];
  const deps = {
    projection,
    git: {
      remoteUrl:
        options.remoteUrl ??
        ((cwd: string) => {
          remoteUrls.push(cwd);
          return Promise.resolve('git@github.com:acme/widgets.git');
        }),
    },
  };
  return { deps, overlay: () => overlay, writes: () => writes, deltas, remoteUrls };
}

describe('addWatch', () => {
  it('defaults the repo from the origin of the session cwd', async () => {
    const { deps, overlay, remoteUrls } = setup({});

    const summary = await addWatch(deps, { sessionId: 's1', pr: 7 });

    expect(remoteUrls).toEqual(['/work/s1']);
    expect(summary).toMatchObject({ repo: 'acme/widgets', pr: 7, status: 'active' });
    expect(overlay().watches).toHaveLength(1);
  });

  it('uses an explicit repo without asking git', async () => {
    const { deps, remoteUrls } = setup({});

    const summary = await addWatch(deps, { sessionId: 's1', pr: 7, repo: 'other/repo' });

    expect(summary.repo).toBe('other/repo');
    expect(remoteUrls).toEqual([]);
  });

  it('treats an explicit repo with a .git suffix as the same repo', async () => {
    const { deps } = setup({});

    const summary = await addWatch(deps, { sessionId: 's1', pr: 7, repo: 'other/repo.git' });

    expect(summary.repo).toBe('other/repo');
  });

  it('treats a differently cased explicit repo as the origin-derived watch', async () => {
    const { deps, overlay } = setup({});
    await addWatch(deps, { sessionId: 's1', pr: 7 });

    await addWatch(deps, { sessionId: 's1', pr: 7, repo: 'Acme/Widgets' });

    expect(overlay().watches).toHaveLength(1);
  });

  it.each([
    ['no origin', () => Promise.resolve(null)],
    ['a non-GitHub origin', () => Promise.resolve('https://gitlab.com/acme/widgets.git')],
    ['a failing git call', () => Promise.reject(new Error('not a git repository'))],
  ])('rejects with RepoUnresolvedError and writes nothing for %s', async (_name, remoteUrl) => {
    const { deps, writes } = setup({ remoteUrl });

    await expect(addWatch(deps, { sessionId: 's1', pr: 7 })).rejects.toBeInstanceOf(
      RepoUnresolvedError,
    );
    expect(writes()).toBe(0);
  });

  it('rejects an explicit repo that is not owner/name', async () => {
    const { deps } = setup({});

    await expect(
      addWatch(deps, { sessionId: 's1', pr: 7, repo: 'not a repo' }),
    ).rejects.toBeInstanceOf(RepoUnresolvedError);
  });

  it('rejects an unknown session', async () => {
    const { deps } = setup({});

    await expect(addWatch(deps, { sessionId: 'nope', pr: 7 })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });

  it('performs no write when a re-add leaves the kinds unchanged', async () => {
    const { deps, writes } = setup({});
    await addWatch(deps, { sessionId: 's1', pr: 7 });
    const before = writes();

    await addWatch(deps, { sessionId: 's1', pr: 7 });

    expect(writes()).toBe(before);
  });

  it('replaces the kinds on a re-add instead of adding a second watch', async () => {
    const { deps, overlay } = setup({});
    await addWatch(deps, { sessionId: 's1', pr: 7 });

    const summary = await addWatch(deps, { sessionId: 's1', pr: 7, kinds: ['review'] });

    expect(summary.kinds).toEqual(['review', 'closed']);
    expect(overlay().watches).toHaveLength(1);
    expect(listWatches(deps, 's1')).toEqual([summary]);
  });
});

describe('removeWatch', () => {
  it('removes a watch by pr and repo', () => {
    const { deps, overlay } = setup({
      watches: [aWatch(), aWatch({ id: 'w2', repo: 'other/repo' })],
    });

    removeWatch(deps, { sessionId: 's1', pr: 7, repo: 'other/repo' });

    expect(overlay().watches.map((w) => w.repo)).toEqual(['acme/widgets']);
  });

  it('matches the repo regardless of .git suffix and case', () => {
    const { deps, overlay } = setup({ watches: [aWatch({ repo: 'other/repo' })] });

    removeWatch(deps, { sessionId: 's1', pr: 7, repo: 'Other/Repo.git' });

    expect(overlay().watches).toEqual([]);
  });

  it('removes a watch by pr alone without asking git', () => {
    const { deps, overlay, remoteUrls } = setup({ watches: [aWatch()] });

    removeWatch(deps, { sessionId: 's1', pr: 7 });

    expect(overlay().watches).toEqual([]);
    expect(remoteUrls).toEqual([]);
    expect(listWatches(deps, 's1')).toEqual([]);
  });

  it('reports a watch that does not exist', () => {
    const { deps, writes } = setup({ watches: [aWatch()] });

    expect(() => removeWatch(deps, { sessionId: 's1', pr: 8 })).toThrow(WatchNotFoundError);
    expect(writes()).toBe(0);
  });

  it('asks for a repo when the pr matches watches in two repos', () => {
    const { deps } = setup({ watches: [aWatch(), aWatch({ id: 'w2', repo: 'other/repo' })] });

    expect(() => removeWatch(deps, { sessionId: 's1', pr: 7 })).toThrow(AmbiguousWatchError);
  });

  it('rejects an unknown session', () => {
    const { deps } = setup({ watches: [aWatch()] });

    expect(() => removeWatch(deps, { sessionId: 'nope', pr: 7 })).toThrow(SessionNotFoundError);
  });
});

describe('watch summaries on SessionState', () => {
  it('change only the affected session', async () => {
    const { deps, deltas } = setup({ sessions: ['s1', 's2'] });

    await addWatch(deps, { sessionId: 's1', pr: 7 });

    const changed = deltas.flatMap((delta) => (delta.type === 'session-changed' ? [delta.id] : []));
    expect(changed).toEqual(['s1']);
  });

  it('are cleared on the session when its last watch is removed', async () => {
    const { deps } = setup({});
    await addWatch(deps, { sessionId: 's1', pr: 7 });

    removeWatch(deps, { sessionId: 's1', pr: 7 });

    expect(listWatches(deps, 's1')).toEqual([]);
  });
});

describe('updateWatches', () => {
  it('prunes an expired closed watch elsewhere in the overlay and updates its session', () => {
    const now = 100 * DAY_MS;
    const expired = aWatch({
      id: 'old',
      sessionId: 's2',
      status: 'closed',
      pendingDigest: { id: 'd', line: 'merged', createdAt: now - 8 * DAY_MS },
    });
    const { deps, overlay } = setup({
      watches: [aWatch(), expired],
      sessions: ['s1', 's2'],
    });
    replayWatches(deps, 0); // surfaces the persisted summaries; nothing has expired at time zero
    expect(listWatches(deps, 's2')).toHaveLength(1);

    updateWatches(
      deps,
      (watches) => watches.map((w) => (w.id === 'w1' ? { ...w, pr: 8 } : w)),
      now,
    );

    expect(overlay().watches.map((w) => w.id)).toEqual(['w1']);
    expect(listWatches(deps, 's2')).toEqual([]);
  });

  it('archives a newly minted digest in the same write that stores it', () => {
    const { deps, overlay, writes } = setup({ watches: [aWatch()] });
    const detail = {
      id: 'd1',
      repo: 'acme/widgets',
      pr: 7,
      line: '#7 acme/widgets: [digest d1] 1 comment',
      createdAt: new Date(DAY_MS).toISOString(),
      replaces: null,
      atMint: { headSha: null, mergeable: null },
      closed: null,
      items: {
        reviews: [],
        issueComments: [],
        reviewComments: [],
        checkRuns: [],
        statuses: [],
        conflicts: [],
      },
    };

    updateWatches(
      deps,
      (watches) =>
        watches.map((w) => ({
          ...w,
          pendingDigest: { id: 'd1', line: detail.line, createdAt: DAY_MS, detail },
        })),
      DAY_MS,
    );

    expect(writes()).toBe(1);
    expect(overlay().digests).toEqual([{ sessionId: 's1', detail }]);

    updateWatches(deps, (watches) => watches.map((w) => ({ ...w, pendingDigest: null })), DAY_MS);

    expect(overlay().digests).toHaveLength(1);
  });

  it('writes when only an archived record expires', () => {
    const { deps, overlay, writes } = setup({ watches: [aWatch()] });
    const old = {
      sessionId: 's1',
      detail: {
        id: 'd1',
        repo: 'acme/widgets',
        pr: 7,
        line: 'x',
        createdAt: new Date(0).toISOString(),
        replaces: null,
        atMint: { headSha: null, mergeable: null },
        closed: null,
        items: {
          reviews: [],
          issueComments: [],
          reviewComments: [],
          checkRuns: [],
          statuses: [],
          conflicts: [],
        },
      },
    };
    deps.projection.updateOverlay((base) => ({ ...base, digests: [old] }));
    const before = writes();

    updateWatches(deps, (watches) => watches, 8 * DAY_MS);

    expect(writes()).toBe(before + 1);
    expect(overlay().digests).toEqual([]);
  });

  it('performs no write when nothing changes', () => {
    const { deps, writes } = setup({ watches: [aWatch()] });

    updateWatches(deps, (watches) => watches, Date.now());

    expect(writes()).toBe(0);
  });
});

describe('replayWatches', () => {
  it('surfaces persisted watches on their sessions', () => {
    const { deps } = setup({ watches: [aWatch()] });

    replayWatches(deps, 1);

    expect(listWatches(deps, 's1')).toEqual([
      expect.objectContaining({ repo: 'acme/widgets', pr: 7 }),
    ]);
  });

  it('persists the pruning of watches that expired while the server was down', () => {
    const now = 100 * DAY_MS;
    const { deps, overlay } = setup({
      watches: [
        aWatch({
          status: 'closed',
          pendingDigest: { id: 'd', line: 'merged', createdAt: now - 8 * DAY_MS },
        }),
        aWatch({ id: 'w2', pr: 9 }),
      ],
    });

    replayWatches(deps, now);

    expect(overlay().watches.map((w) => w.id)).toEqual(['w2']);
    expect(listWatches(deps, 's1')).toEqual([expect.objectContaining({ pr: 9 })]);
  });
});
