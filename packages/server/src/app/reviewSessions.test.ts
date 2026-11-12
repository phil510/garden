import { DEFAULT_UI_STATE } from '@garden/shared';
import { aSession } from '@garden/shared/fixtures';
import type { ReviewItem, SessionState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import { NoLocalCloneError, ReviewNotFoundError, SessionNotFoundError } from './errors.js';
import type { TmuxNewSessionRequest, TmuxPort } from './ports.js';
import type { Projection } from './projection.js';
import type { ReviewStore } from './reviews.js';
import { createReviewStore } from './reviews.js';
import { memoryOverlay } from './reviews.fixture.js';
import { createReviewSessions } from './reviewSessions.js';

const aReview = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  key: 'acme/widgets#7',
  repo: 'acme/widgets',
  number: 7,
  title: 'Add widgets',
  author: 'octocat',
  url: 'https://github.com/acme/widgets/pull/7',
  draft: false,
  updatedAt: '2026-01-10T00:00:00Z',
  clonePath: '/r/widgets',
  sessionId: null,
  ...overrides,
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function harness(
  items: ReviewItem[],
  gate?: Promise<void>,
  sessionIds: string[] = [],
  reviewsFor?: (sessions: SessionState[]) => Pick<ReviewStore, 'item' | 'link'>,
) {
  const known = sessionIds.map((id) => aSession({ id }));
  const spawned: TmuxNewSessionRequest[] = [];
  const links = new Map<string, string>();
  const tmux: TmuxPort = {
    listPanes: () => Promise.resolve([]),
    newSession: async (request) => {
      await gate;
      spawned.push(request);
    },
    respawnPane: () => Promise.reject(new Error('not used by this test')),
    killSession: () => Promise.reject(new Error('not used by this test')),
  };
  const dispatched: GardenEvent[] = [];
  const unused = () => {
    throw new Error('not used by this test');
  };
  const projection: Projection = {
    sessions: () => known,
    uiState: () => DEFAULT_UI_STATE,
    dispatch: (event) => {
      dispatched.push(event);
      if (event.type === 'session-registered') known.push(aSession({ id: event.id }));
    },
    updateUiState: unused,
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    overlay: unused,
    updateOverlay: unused,
    subscribeOverlay: () => () => undefined,
    placementOf: () => undefined,
  };
  const sessions = createReviewSessions({
    tmux,
    projection,
    serverPort: 4310,
    settingsPath: '/home/.garden/claude-settings.json',
    readClaudeCommand: () => ['claude'],
    reviews: reviewsFor?.(known) ?? {
      item: (key) => {
        const found = items.find((candidate) => candidate.key === key);
        const sessionId = links.get(key);
        return found === undefined
          ? undefined
          : { ...found, sessionId: sessionId ?? found.sessionId };
      },
      link: (key, sessionId) => links.set(key, sessionId),
    },
  });
  return { sessions, spawned, links };
}

describe('createReviewSessions', () => {
  it('starts a session in the clone path and links it', async () => {
    const { sessions, spawned, links } = harness([aReview()]);
    const { sessionId } = await sessions.start('acme', 'widgets', 7);
    expect(spawned.map((request) => request.cwd)).toEqual(['/r/widgets']);
    expect(spawned[0]?.sessionId).toBe(sessionId);
    expect(links.get('acme/widgets#7')).toBe(sessionId);
  });

  it('replaces a link to a session missing from the projection with a new session', async () => {
    const key = 'acme/widgets#7';
    let store!: ReviewStore;
    const { sessions, spawned } = harness([], undefined, [], (known) => {
      store = createReviewStore({ overlay: memoryOverlay({ [key]: 'gone' }, known) });
      store.complete([aReview()], '2026-01-10T00:00:00Z');
      return store;
    });
    const { sessionId } = await sessions.start('acme', 'widgets', 7);
    expect(sessionId).not.toBe('gone');
    expect(spawned.map((request) => request.cwd)).toEqual(['/r/widgets']);
    expect(store.item(key)?.sessionId).toBe(sessionId);
  });

  it('matches the owner and name case-insensitively', async () => {
    const { sessions, spawned } = harness([aReview()]);
    await sessions.start('Acme', 'Widgets', 7);
    expect(spawned).toHaveLength(1);
  });

  it('returns the linked session without starting another', async () => {
    const { sessions, spawned } = harness([aReview({ sessionId: 'session-1' })]);
    expect(await sessions.start('acme', 'widgets', 7)).toEqual({ sessionId: 'session-1' });
    expect(spawned).toEqual([]);
  });

  it('makes one session for concurrent starts and returns it to both', async () => {
    const gate = deferred<void>();
    const { sessions, spawned } = harness([aReview()], gate.promise);
    const first = sessions.start('acme', 'widgets', 7);
    const second = sessions.start('acme', 'widgets', 7);
    await Promise.resolve();
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(spawned).toHaveLength(1);
  });

  it('starts nothing when the repo has no local clone', async () => {
    const { sessions, spawned } = harness([aReview({ clonePath: null })]);
    await expect(sessions.start('acme', 'widgets', 7)).rejects.toThrow(NoLocalCloneError);
    expect(spawned).toEqual([]);
  });

  it('rejects a request that is not in the queue and an owner that is not a name', async () => {
    const { sessions, spawned } = harness([aReview()]);
    await expect(sessions.start('acme', 'widgets', 8)).rejects.toThrow(ReviewNotFoundError);
    await expect(sessions.start('..', 'widgets', 7)).rejects.toThrow(ReviewNotFoundError);
    expect(spawned).toEqual([]);
  });
});

describe('claim', () => {
  const claim = (sessions: ReturnType<typeof harness>['sessions'], sessionId: string) =>
    sessions.claim('acme', 'widgets', 7, sessionId);

  it('links the request to an existing session', () => {
    const { sessions, links } = harness([aReview()], undefined, ['s1']);
    expect(claim(sessions, 's1')).toEqual({ sessionId: 's1', previousSessionId: null });
    expect(links.get('acme/widgets#7')).toBe('s1');
  });

  it('moves a link and names the session it left', () => {
    const { sessions, links } = harness([aReview({ sessionId: 's1' })], undefined, ['s1', 's2']);
    expect(claim(sessions, 's2')).toEqual({ sessionId: 's2', previousSessionId: 's1' });
    expect(links.get('acme/widgets#7')).toBe('s2');
  });

  it('writes nothing when the session already holds the link', () => {
    const { sessions, links } = harness([aReview({ sessionId: 's1' })], undefined, ['s1']);
    expect(claim(sessions, 's1')).toEqual({ sessionId: 's1', previousSessionId: null });
    expect(links.size).toBe(0);
  });

  it('rejects an unknown session without writing a link', () => {
    const { sessions, links } = harness([aReview()], undefined, ['s1']);
    expect(() => claim(sessions, 'nope')).toThrow(SessionNotFoundError);
    expect(links.size).toBe(0);
  });

  it('rejects a request that is not in the queue without writing a link', () => {
    const { sessions, links } = harness([aReview()], undefined, ['s1']);
    expect(() => sessions.claim('acme', 'widgets', 8, 's1')).toThrow(ReviewNotFoundError);
    expect(links.size).toBe(0);
  });
});
