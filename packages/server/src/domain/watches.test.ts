import type { DigestDetail } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import {
  archiveDigests,
  normalizeRepo,
  dropSessionWatches,
  normalizeKinds,
  parseGitHubRepo,
  pruneWatches,
  removeWatch,
  summarizeWatches,
  upsertWatch,
} from './watches.js';
import type { DigestRecord, Watch } from './watches.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

function aWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: 'w1',
    sessionId: 's1',
    repo: 'acme/widgets',
    pr: 7,
    kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
    createdAt: 5,
    cursor: null,
    pendingDigest: null,
    status: 'active',
    ...overrides,
  };
}

const digest = (createdAt: number) => ({ id: 'd1', line: 'something happened', createdAt });

describe('normalizeKinds', () => {
  it('applies the default set when no kinds are given', () => {
    expect(normalizeKinds(undefined)).toEqual([
      'review',
      'comment',
      'checks',
      'conflict',
      'closed',
    ]);
  });

  it('always includes closed, even when it is left out', () => {
    expect(normalizeKinds(['review'])).toEqual(['review', 'closed']);
  });

  it('turns on checks when checks:all is requested', () => {
    expect(normalizeKinds(['checks:all'])).toEqual(['checks', 'checks:all', 'closed']);
  });

  it('dedupes and orders kinds canonically regardless of input order', () => {
    expect(normalizeKinds(['conflict', 'review', 'conflict'])).toEqual([
      'review',
      'conflict',
      'closed',
    ]);
  });
});

describe('parseGitHubRepo', () => {
  it.each([
    'git@github.com:acme/widgets.git',
    'git@github.com:acme/widgets',
    'https://github.com/acme/widgets.git',
    'https://github.com/acme/widgets',
    'https://github.com/acme/widgets/',
    'https://user:token@github.com/acme/widgets.git',
    'ssh://git@github.com/acme/widgets.git',
    'ssh://git@github.com:22/acme/widgets',
  ])('reads owner/name from %s', (url) => {
    expect(parseGitHubRepo(url)).toBe('acme/widgets');
  });

  it('keeps dots inside a repo name', () => {
    expect(parseGitHubRepo('git@github.com:acme/widgets.js.git')).toBe('acme/widgets.js');
  });

  it.each([
    'git@gitlab.com:acme/widgets.git',
    'https://example.com/acme/widgets',
    'https://github.com/acme',
    'https://github.com/acme/widgets/extra',
    '/local/path/widgets',
    '',
  ])('rejects %s', (url) => {
    expect(parseGitHubRepo(url)).toBeNull();
  });
});

describe('normalizeRepo', () => {
  it('accepts owner/name and rejects anything else', () => {
    expect(normalizeRepo('acme/widgets')).toBe('acme/widgets');
    for (const bad of ['acme', 'acme/widgets/x', 'acme/ widgets', '../widgets', '', 'acme/.git'])
      expect(normalizeRepo(bad), bad).toBeNull();
  });

  it('strips .git and lowercases so spellings of one repo compare equal', () => {
    expect(normalizeRepo('Acme/Widgets.GIT')).toBe('acme/widgets');
    expect(normalizeRepo('acme/widgets.js')).toBe('acme/widgets.js');
  });
});

describe('upsertWatch', () => {
  const input = { sessionId: 's1', repo: 'acme/widgets', pr: 7 };

  it('creates an active watch with default kinds, no cursor and no digest', () => {
    const { watches, watch } = upsertWatch([], input, NOW, () => 'new-id');
    expect(watches).toEqual([watch]);
    expect(watch).toEqual({
      id: 'new-id',
      sessionId: 's1',
      repo: 'acme/widgets',
      pr: 7,
      kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
      createdAt: NOW,
      cursor: null,
      pendingDigest: null,
      status: 'active',
    });
  });

  it('treats the same PR number in two repos as two watches', () => {
    const first = upsertWatch([], input, NOW, () => 'a').watches;
    const { watches } = upsertWatch(first, { ...input, repo: 'acme/gadgets' }, NOW, () => 'b');
    expect(watches.map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('treats the same PR in two sessions as two watches', () => {
    const first = upsertWatch([], input, NOW, () => 'a').watches;
    const { watches } = upsertWatch(first, { ...input, sessionId: 's2' }, NOW, () => 'b');
    expect(watches).toHaveLength(2);
  });

  it('replaces kinds on a re-add and keeps id, createdAt, cursor, digest and status', () => {
    const existing = aWatch({ cursor: { etag: 'x' }, pendingDigest: digest(9), status: 'error' });
    const { watches, watch } = upsertWatch(
      [existing],
      { ...input, kinds: ['review'] },
      NOW,
      () => 'unused',
    );
    expect(watches).toHaveLength(1);
    expect(watch).toEqual({ ...existing, kinds: ['review', 'closed'] });
  });

  it('returns the input array when a re-add leaves the kinds unchanged', () => {
    const existing = [aWatch()];
    const { watches, watch } = upsertWatch(existing, input, NOW, () => 'unused');
    expect(watches).toBe(existing);
    expect(watch).toBe(existing[0]);
  });

  it('keeps a closed watch closed when it is re-added', () => {
    const existing = aWatch({ status: 'closed' });
    const { watch } = upsertWatch([existing], { ...input, kinds: ['review'] }, NOW, () => 'x');
    expect(watch.status).toBe('closed');
  });
});

describe('removeWatch', () => {
  it('removes by session, repo and pr', () => {
    const keep = aWatch({ id: 'keep', repo: 'acme/gadgets' });
    const result = removeWatch([aWatch(), keep], 's1', 7, 'acme/widgets');
    expect(result).toEqual({ outcome: 'removed', watches: [keep] });
  });

  it('finds the one watch for a pr when no repo is given', () => {
    const other = aWatch({ id: 'other', sessionId: 's2' });
    const result = removeWatch([aWatch(), other], 's1', 7);
    expect(result).toEqual({ outcome: 'removed', watches: [other] });
  });

  it('reports ambiguity when the pr is watched in two repos and no repo is given', () => {
    const watches = [aWatch(), aWatch({ id: 'w2', repo: 'acme/gadgets' })];
    expect(removeWatch(watches, 's1', 7)).toEqual({ outcome: 'ambiguous' });
  });

  it('reports not-found when nothing matches', () => {
    expect(removeWatch([aWatch()], 's1', 8)).toEqual({ outcome: 'not-found' });
    expect(removeWatch([aWatch()], 's1', 7, 'acme/other')).toEqual({ outcome: 'not-found' });
    expect(removeWatch([aWatch()], 's2', 7)).toEqual({ outcome: 'not-found' });
  });
});

describe('pruneWatches', () => {
  it('keeps a digest exactly seven days old', () => {
    const watches = [aWatch({ pendingDigest: digest(NOW - 7 * DAY) })];
    expect(pruneWatches(watches, NOW)).toBe(watches);
  });

  it('drops a digest older than seven days but keeps the watch', () => {
    const [pruned] = pruneWatches([aWatch({ pendingDigest: digest(NOW - 7 * DAY - 1) })], NOW);
    expect(pruned).toEqual(aWatch({ pendingDigest: null }));
  });

  it('keeps a closed watch that still has a pending digest', () => {
    const watches = [aWatch({ status: 'closed', pendingDigest: digest(NOW) })];
    expect(pruneWatches(watches, NOW)).toBe(watches);
  });

  it('removes a closed watch with no pending digest', () => {
    expect(pruneWatches([aWatch({ status: 'closed' })], NOW)).toEqual([]);
  });

  it('removes a closed watch whose digest expires in the same pass', () => {
    const watches = [aWatch({ status: 'closed', pendingDigest: digest(NOW - 8 * DAY) })];
    expect(pruneWatches(watches, NOW)).toEqual([]);
  });

  it('returns the input array when nothing changes', () => {
    const watches = [aWatch(), aWatch({ id: 'w2', pendingDigest: digest(NOW) })];
    expect(pruneWatches(watches, NOW)).toBe(watches);
  });
});

describe('summarizeWatches', () => {
  it('groups by session ordered by repo then pr, exposing only the summary fields', () => {
    const summaries = summarizeWatches([
      aWatch({ id: 'a', repo: 'acme/widgets', pr: 9 }),
      aWatch({ id: 'b', repo: 'acme/gadgets', pr: 20, pendingDigest: digest(1) }),
      aWatch({ id: 'c', repo: 'acme/widgets', pr: 7, status: 'error' }),
      aWatch({ id: 'd', sessionId: 's2' }),
    ]);
    expect(Object.keys(summaries).sort()).toEqual(['s1', 's2']);
    expect(summaries['s1']?.map((s) => [s.repo, s.pr])).toEqual([
      ['acme/gadgets', 20],
      ['acme/widgets', 7],
      ['acme/widgets', 9],
    ]);
    expect(summaries['s1']?.[0]).toEqual({
      repo: 'acme/gadgets',
      pr: 20,
      kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
      pendingDigest: true,
      status: 'active',
    });
    expect(summaries['s1']?.[1]?.pendingDigest).toBe(false);
  });

  it('carries the error reason through to the summary', () => {
    const summaries = summarizeWatches([aWatch({ status: 'error', errorReason: 'No access.' })]);

    expect(summaries['s1']?.[0]).toMatchObject({ status: 'error', errorReason: 'No access.' });
  });
});

describe('dropSessionWatches', () => {
  it("drops all of a session's watches, with or without a pending digest", () => {
    const watches = [
      aWatch({ id: 'a' }),
      aWatch({ id: 'b', pr: 8, pendingDigest: digest(NOW) }),
      aWatch({ id: 'c', sessionId: 's2' }),
    ];

    expect(dropSessionWatches(watches, 's1').map((w) => w.id)).toEqual(['c']);
  });

  it('returns the same array when the session has no watches', () => {
    const watches = [aWatch({ sessionId: 's2' })];

    expect(dropSessionWatches(watches, 's1')).toBe(watches);
  });
});

describe('archiveDigests', () => {
  const aDetail = (id: string, createdAt: number, overrides: Partial<DigestDetail> = {}) => ({
    id,
    repo: 'acme/widgets',
    pr: 7,
    line: `#7 acme/widgets: [digest ${id}] 1 comment`,
    createdAt: new Date(createdAt).toISOString(),
    replaces: null,
    atMint: { headSha: 'sha1', mergeable: true },
    closed: null,
    items: {
      reviews: [],
      issueComments: [],
      reviewComments: [],
      checkRuns: [],
      statuses: [],
      conflicts: [],
    },
    ...overrides,
  });
  const minted = (id: string, createdAt: number, watch: Partial<Watch> = {}) =>
    aWatch({
      pendingDigest: { id, line: 'x', createdAt, detail: aDetail(id, createdAt) },
      ...watch,
    });
  const ids = (archive: readonly DigestRecord[]) => archive.map((r) => r.detail.id);

  it('archives the detail of a pending digest with its session', () => {
    const archive = archiveDigests([], [minted('d1', NOW)], NOW);

    expect(archive).toEqual([{ sessionId: 's1', detail: aDetail('d1', NOW) }]);
  });

  it('adds nothing for a digest without a detail and returns the same array', () => {
    const archive: readonly DigestRecord[] = [];

    expect(archiveDigests(archive, [aWatch({ pendingDigest: digest(NOW) })], NOW)).toBe(archive);
  });

  it('does not archive a digest twice and returns the same array when nothing changed', () => {
    const once = archiveDigests([], [minted('d1', NOW)], NOW);

    expect(archiveDigests(once, [minted('d1', NOW)], NOW)).toBe(once);
  });

  it('keeps a superseded digest after a re-mint', () => {
    const first = archiveDigests([], [minted('d1', NOW)], NOW);

    const second = archiveDigests(first, [minted('d2', NOW + 1)], NOW + 1);

    expect(ids(second)).toEqual(['d1', 'd2']);
  });

  it('keeps a record after the digest is acknowledged or its watch removed', () => {
    const archive = archiveDigests([], [minted('d1', NOW)], NOW);

    expect(archiveDigests(archive, [aWatch({ pendingDigest: null })], NOW)).toBe(archive);
    expect(archiveDigests(archive, [], NOW)).toBe(archive);
  });

  it('keeps a record exactly seven days old and drops one older', () => {
    const archive = archiveDigests([], [minted('d1', NOW - 7 * DAY)], NOW - 7 * DAY);

    expect(archiveDigests(archive, [], NOW)).toBe(archive);
    expect(archiveDigests(archive, [], NOW + 1)).toEqual([]);
  });

  it('never expires a record while its pending digest is live, so it is not archived again', () => {
    const watch = minted('d1', NOW - 7 * DAY);
    const archive = archiveDigests([], [watch], NOW - 7 * DAY);

    const pruned = pruneWatches([watch], NOW);

    expect(pruned).toEqual([watch]);
    expect(archiveDigests(archive, pruned, NOW)).toBe(archive);
  });

  it('keeps the newest twenty records per watch and leaves other watches alone', () => {
    const other = aWatch({ id: 'w2', pr: 9 });
    let archive: readonly DigestRecord[] = [];
    for (let i = 0; i < 25; i += 1)
      archive = archiveDigests(archive, [minted(`d${String(i)}`, NOW + i)], NOW + i);
    archive = archiveDigests(
      archive,
      [
        {
          ...other,
          pendingDigest: {
            id: 'o1',
            line: 'x',
            createdAt: NOW,
            detail: aDetail('o1', NOW, { pr: 9 }),
          },
        },
      ],
      NOW + 25,
    );

    expect(ids(archive).filter((id) => id.startsWith('d'))).toEqual(
      Array.from({ length: 20 }, (_, i) => `d${String(i + 5)}`),
    );
    expect(ids(archive)).toContain('o1');
  });
});
