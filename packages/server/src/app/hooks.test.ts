import { aHookEvent } from '@garden/shared/fixtures';
import type { PipeServerMessage } from '@garden/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Watch } from '../domain/watches.js';
import { handleHook } from './hooks.js';
import { createPipes } from './pipes.js';
import type { OverlayState, StorePort } from './ports.js';
import { createProjection } from './projection.js';
import { updateWatches } from './watches.js';

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

const NOW = 1_000 * 24 * 60 * 60 * 1000;
const GARDEN_ID = 'garden-1';
const NEW_CLAUDE_ID = 'claude-after-clear';

function aWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: 'w1',
    sessionId: GARDEN_ID,
    repo: 'acme/widgets',
    pr: 7,
    kinds: ['review', 'comment', 'checks', 'conflict', 'closed'],
    createdAt: NOW,
    cursor: null,
    pendingDigest: null,
    status: 'active',
    ...overrides,
  };
}

const digest = (id: string) => ({ id, line: `line ${id}`, createdAt: NOW });

function setup(watches: Watch[]) {
  let overlay: OverlayState = { ...emptyOverlay, watches };
  const store: StorePort = {
    read: () => overlay,
    write: (state) => {
      overlay = state;
    },
  };
  const projection = createProjection(store);
  for (const id of [GARDEN_ID, 'other'])
    projection.dispatch({ type: 'session-registered', id, tmuxName: id, cwd: `/work/${id}` });
  const deps = { projection, git: { remoteUrl: () => Promise.resolve(null) } };
  const summaries = (id: string) => projection.sessions().find((s) => s.id === id)?.watches;
  return { projection, deps, pipes: createPipes(deps), watches: () => overlay.watches, summaries };
}

const sessionStart = (source?: 'startup' | 'resume' | 'clear' | 'compact' | 'fork') =>
  aHookEvent({
    session_id: NEW_CLAUDE_ID,
    hook_event_name: 'SessionStart',
    ...(source === undefined ? {} : { source }),
  });

const settle = () => Promise.resolve();

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => vi.restoreAllMocks());

describe('handleHook on /clear', () => {
  it("removes the garden session's watches and digests, keyed on the garden id, not the payload", () => {
    const t = setup([
      aWatch({ id: 'a', pendingDigest: digest('d1') }),
      aWatch({ id: 'b', pr: 8 }),
      aWatch({ id: 'c', sessionId: 'other' }),
    ]);

    handleHook(t.deps, sessionStart('clear'), GARDEN_ID);

    expect(t.watches().map((w) => w.id)).toEqual(['c']);
    expect(t.summaries(GARDEN_ID)).toEqual([]);
  });

  it.each(['startup', 'resume', 'compact', 'fork', undefined] as const)(
    'leaves watches alone for source %s',
    (source) => {
      const t = setup([aWatch({ pendingDigest: digest('d1') })]);

      handleHook(t.deps, sessionStart(source), GARDEN_ID);

      expect(t.watches()).toHaveLength(1);
    },
  );

  it('leaves watches alone for a clear without a garden id, and still dispatches the hook', () => {
    const t = setup([aWatch()]);

    handleHook(t.deps, sessionStart('clear'), undefined);

    expect(t.watches()).toHaveLength(1);
    expect(t.projection.sessions().map((s) => s.id)).toContain(NEW_CLAUDE_ID);
  });

  it('leaves watches alone for an event that is not SessionStart', () => {
    const t = setup([aWatch()]);

    handleHook(
      t.deps,
      aHookEvent({
        session_id: NEW_CLAUDE_ID,
        hook_event_name: 'UserPromptSubmit',
        source: 'clear',
      }),
      GARDEN_ID,
    );

    expect(t.watches()).toHaveLength(1);
  });

  it('stops a connected pipe delivering a removed digest, and delivers the next watch', async () => {
    const t = setup([]);
    const received: PipeServerMessage[] = [];
    t.pipes.connect(GARDEN_ID, (m) => received.push(m));
    updateWatches(t.deps, () => [aWatch({ pendingDigest: digest('d1') })], NOW);
    handleHook(t.deps, sessionStart('clear'), GARDEN_ID);
    await settle();
    expect(received).toEqual([]);

    updateWatches(t.deps, () => [aWatch({ id: 'w2', pr: 9, pendingDigest: digest('d2') })], NOW);
    await settle();

    expect(received.map((m) => m.id)).toEqual(['d2']);
  });
});

describe('handleHook keying', () => {
  it('lands a post-clear hook on the garden session instead of creating a second row', () => {
    const t = setup([]);

    handleHook(
      t.deps,
      aHookEvent({ session_id: GARDEN_ID, hook_event_name: 'SessionEnd' }),
      GARDEN_ID,
    );
    handleHook(t.deps, sessionStart('clear'), GARDEN_ID);

    const ids = t.projection.sessions().map((s) => s.id);
    expect(ids).not.toContain(NEW_CLAUDE_ID);
    expect(ids).toContain(GARDEN_ID);
  });
});
