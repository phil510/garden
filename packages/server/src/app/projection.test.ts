import { aHookEvent } from '@garden/shared/fixtures';
import type { Delta, UiState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { GardenEvent } from '../domain/types.js';
import type { OverlayState, StorePort } from './ports.js';
import { createProjection } from './projection.js';

const emptyOverlay: OverlayState = {
  version: 1,
  tmuxNames: {},
  hideDead: false,
  groups: {},
  stage: { preset: 'single', slots: [null], focusedSlot: 0, layout: {} },
};

/** In-memory StorePort: the projection's contract with the store is read-modify-write,
 *  so the fake has to hold what it was handed. */
function fakeStore(initial: OverlayState = emptyOverlay) {
  let current = initial;
  const port: StorePort = {
    read: () => current,
    write: (state) => {
      current = state;
    },
  };
  return { port, written: () => current };
}

const now = 1_700_000_000_000;

const transcript = (): GardenEvent => ({
  type: 'transcript-changed',
  path: '/t.jsonl',
  record: {
    sessionId: 'sid-1',
    cwd: '/Users/dev/repo',
    gitBranch: 'main',
    title: 'Wire the fold',
    lastPrompt: null,
    recap: null,
    lastActivity: now,
  },
});

const hook = (name: string, id = 'sid-1'): GardenEvent => ({
  type: 'hook',
  payload: aHookEvent({ session_id: id, hook_event_name: name }),
});

describe('dispatch', () => {
  it('notifies subscribers with the deltas the fold produced', () => {
    const projection = createProjection(fakeStore().port);
    const seen: Delta[][] = [];
    projection.subscribe((deltas) => seen.push(deltas));

    projection.dispatch(hook('UserPromptSubmit'));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    const [delta] = seen[0] ?? [];
    expect(delta?.type).toBe('session-added');
    expect(delta?.type === 'session-added' && delta.session.id).toBe('sid-1');
  });

  it('notifies nobody when the fold changes nothing', () => {
    const projection = createProjection(fakeStore().port);
    projection.dispatch(transcript());
    const seen: Delta[][] = [];
    projection.subscribe((deltas) => seen.push(deltas));

    projection.dispatch(transcript());

    expect(seen).toEqual([]);
  });

  it('sends only the changed fields once a session exists', () => {
    const projection = createProjection(fakeStore().port);
    projection.dispatch(hook('UserPromptSubmit'));
    const seen: Delta[][] = [];
    projection.subscribe((deltas) => seen.push(deltas));

    projection.dispatch(transcript());

    expect(seen).toEqual([
      [
        {
          type: 'session-changed',
          id: 'sid-1',
          changes: { branch: 'main', title: 'Wire the fold', lastActivity: now },
        },
      ],
    ]);
  });

  it('reaches every subscriber, and none after it unsubscribes', () => {
    const projection = createProjection(fakeStore().port);
    const first: Delta[][] = [];
    const second: Delta[][] = [];
    const unsubscribe = projection.subscribe((deltas) => first.push(deltas));
    projection.subscribe((deltas) => second.push(deltas));

    projection.dispatch(hook('UserPromptSubmit', 'sid-1'));
    unsubscribe();
    projection.dispatch(hook('UserPromptSubmit', 'sid-2'));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
  });

  it('exposes the folded sessions', () => {
    const projection = createProjection(fakeStore().port);
    projection.dispatch(hook('UserPromptSubmit', 'sid-1'));
    projection.dispatch(hook('UserPromptSubmit', 'sid-2'));

    expect(projection.sessions().map((s) => s.id)).toEqual(['sid-1', 'sid-2']);
  });
});

describe('ui state', () => {
  const overlay: OverlayState = {
    version: 1,
    tmuxNames: { 'sid-1': 'repo' },
    hideDead: true,
    groups: {
      '/repos/b': { pinned: false, order: 1, collapsed: true },
      '/repos/a': { pinned: true, order: 0, collapsed: false },
    },
    stage: {
      preset: 'two-across',
      slots: ['sid-1', null],
      focusedSlot: 1,
      layout: { grid: 'opaque' },
    },
  };

  it('orders the groups by the store order rather than by insertion', () => {
    const projection = createProjection(fakeStore(overlay).port);

    expect(projection.uiState()).toEqual<UiState>({
      hideDead: true,
      groupOrder: ['/repos/a', '/repos/b'],
      pinnedRepos: ['/repos/a'],
      collapsedRepos: ['/repos/b'],
      preset: 'two-across',
      slots: ['sid-1', null],
      focusedSlot: 1,
    });
  });

  it('applies a partial update and leaves the rest of the slice standing', () => {
    const projection = createProjection(fakeStore(overlay).port);

    projection.updateUiState({ hideDead: false, focusedSlot: 0 });

    expect(projection.uiState()).toMatchObject({
      hideDead: false,
      focusedSlot: 0,
      preset: 'two-across',
      groupOrder: ['/repos/a', '/repos/b'],
    });
  });

  it('preserves the store fields the client never sees', () => {
    const store = fakeStore(overlay);
    const projection = createProjection(store.port);

    projection.updateUiState({ hideDead: false });

    expect(store.written().tmuxNames).toEqual({ 'sid-1': 'repo' });
    expect(store.written().stage.layout).toEqual({ grid: 'opaque' });
    expect(store.written().version).toBe(1);
  });

  it('writes a reordered group list back as store orders', () => {
    const store = fakeStore(overlay);
    const projection = createProjection(store.port);

    projection.updateUiState({ groupOrder: ['/repos/b', '/repos/a'] });

    expect(store.written().groups).toEqual({
      '/repos/b': { pinned: false, order: 0, collapsed: true },
      '/repos/a': { pinned: true, order: 1, collapsed: false },
    });
    expect(projection.uiState().groupOrder).toEqual(['/repos/b', '/repos/a']);
  });

  it('keeps a repo named only as pinned, ordering it after the ordered ones', () => {
    const store = fakeStore(emptyOverlay);
    const projection = createProjection(store.port);

    projection.updateUiState({ groupOrder: ['/repos/a'], pinnedRepos: ['/repos/z'] });

    expect(store.written().groups).toEqual({
      '/repos/a': { pinned: false, order: 0, collapsed: false },
      '/repos/z': { pinned: true, order: 1, collapsed: false },
    });
  });

  it('notifies ui subscribers, and none after they unsubscribe', () => {
    const projection = createProjection(fakeStore(overlay).port);
    const seen: UiState[] = [];
    const unsubscribe = projection.subscribeUiState((ui) => seen.push(ui));

    projection.updateUiState({ hideDead: false });
    unsubscribe();
    projection.updateUiState({ hideDead: true });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.hideDead).toBe(false);
  });

  it('does not notify session subscribers when only the ui slice moves', () => {
    const projection = createProjection(fakeStore(overlay).port);
    const seen: Delta[][] = [];
    projection.subscribe((deltas) => seen.push(deltas));

    projection.updateUiState({ hideDead: false });

    expect(seen).toEqual([]);
  });
});

describe('updateUiState when the store write fails', () => {
  it('leaves the reported ui state and its subscribers untouched', () => {
    const failing: StorePort = {
      read: () => emptyOverlay,
      write: () => {
        throw new Error('EACCES');
      },
    };
    const projection = createProjection(failing);
    const seen: UiState[] = [];
    projection.subscribeUiState((ui) => void seen.push(ui));

    expect(() => projection.updateUiState({ hideDead: true })).toThrow('EACCES');
    expect(projection.uiState().hideDead).toBe(false);
    expect(seen).toEqual([]);
  });
});
