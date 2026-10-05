import type { DigestDetail } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { DigestNotFoundError, getDigest } from './digests.js';
import type { Projection } from './projection.js';

const aDetail = (id: string): DigestDetail => ({
  id,
  repo: 'acme/widgets',
  pr: 7,
  line: `#7 acme/widgets: [digest ${id}] 1 comment`,
  createdAt: '2026-01-01T00:00:00.000Z',
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
});

const depsHolding = (...ids: string[]) => ({
  projection: {
    overlay: () => ({
      digests: ids.map((id) => ({ sessionId: 's1', detail: aDetail(id) })),
    }),
  } as unknown as Pick<Projection, 'overlay'>,
});

describe('getDigest', () => {
  it('returns the archived detail with that id, whichever session it was delivered to', () => {
    expect(getDigest(depsHolding('a', 'b'), 'b')).toEqual(aDetail('b'));
  });

  it('throws DigestNotFoundError for an id that is not archived', () => {
    expect(() => getDigest(depsHolding('a'), 'zzz')).toThrow(DigestNotFoundError);
  });
});
