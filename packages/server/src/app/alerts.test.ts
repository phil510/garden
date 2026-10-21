import { DEFAULT_UI_STATE } from '@garden/shared';
import type { Delta } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import type { OverlayState, StorePort } from './ports.js';
import { clearSessionAlert, raiseSessionAlert, replayAlerts } from './alerts.js';
import { createProjection } from './projection.js';

const emptyOverlay: OverlayState = {
  version: 2,
  tmuxNames: {},
  ui: DEFAULT_UI_STATE,
  watches: [],
  alerts: [],
  digests: [],
  pipes: {},
};

/** A real projection over an in-memory store; `writes` counts store writes. */
function setup(options: { sessions?: readonly string[] } = {}) {
  let failWrites = false;
  let overlay = emptyOverlay;
  let writes = 0;
  const store: StorePort = {
    read: () => overlay,
    write: (state) => {
      if (failWrites) throw new Error('disk full');
      overlay = state;
      writes += 1;
    },
  };
  const projection = createProjection(store);
  for (const id of options.sessions ?? ['s1'])
    projection.dispatch({ type: 'session-registered', id, tmuxName: id, cwd: `/work/${id}` });
  writes = 0;
  const deltas: Delta[] = [];
  projection.subscribe((batch) => deltas.push(...batch));
  const alertOf = (id: string) => projection.sessions().find((s) => s.id === id)?.alert;
  return {
    deps: { projection },
    store,
    failWrites: () => {
      failWrites = true;
    },
    overlay: () => overlay,
    writes: () => writes,
    deltas,
    alertOf,
  };
}

describe('raiseSessionAlert', () => {
  it('persists the alert and shows it on that session only', () => {
    const { deps, overlay, deltas, alertOf } = setup({ sessions: ['s1', 's2'] });

    const alert = raiseSessionAlert(deps, 's1', 'stuck on CI', 100);

    expect(alert).toEqual({ text: 'stuck on CI', raisedAt: 100, updatedAt: 100 });
    expect(overlay().alerts).toEqual([{ sessionId: 's1', ...alert }]);
    expect(alertOf('s1')).toEqual(alert);
    expect(alertOf('s2')).toBeNull();
    expect(deltas).toEqual([{ type: 'session-changed', id: 's1', changes: { alert } }]);
  });

  it('replaces the text on a second raise, keeping raisedAt and the single overlay entry', () => {
    const { deps, overlay, alertOf } = setup();
    raiseSessionAlert(deps, 's1', 'first', 100);

    raiseSessionAlert(deps, 's1', 'second', 250);

    expect(alertOf('s1')).toEqual({ text: 'second', raisedAt: 100, updatedAt: 250 });
    expect(overlay().alerts).toHaveLength(1);
  });

  it('throws for an unknown session without writing or dispatching', () => {
    const { deps, writes, deltas } = setup();

    expect(() => raiseSessionAlert(deps, 'nope', 'x', 1)).toThrow('no such session: nope');
    expect(writes()).toBe(0);
    expect(deltas).toEqual([]);
  });

  it('dispatches nothing when the overlay write throws', () => {
    const { deps, deltas, alertOf, failWrites } = setup();
    failWrites();

    expect(() => raiseSessionAlert(deps, 's1', 'x', 1)).toThrow('disk full');
    expect(deltas).toEqual([]);
    expect(alertOf('s1')).toBeNull();
  });
});

describe('clearSessionAlert', () => {
  it('removes the alert from the overlay and the session', () => {
    const { deps, overlay, alertOf } = setup();
    raiseSessionAlert(deps, 's1', 'stuck', 100);

    clearSessionAlert(deps, 's1');

    expect(overlay().alerts).toEqual([]);
    expect(alertOf('s1')).toBeNull();
  });

  it('writes and dispatches nothing when the session has no alert', () => {
    const { deps, writes, deltas } = setup();

    clearSessionAlert(deps, 's1');

    expect(writes()).toBe(0);
    expect(deltas).toEqual([]);
  });

  it('throws for an unknown session', () => {
    const { deps } = setup();
    expect(() => clearSessionAlert(deps, 'nope')).toThrow('no such session: nope');
  });
});

describe('replayAlerts', () => {
  it('surfaces persisted alerts on a fresh projection over the same store', () => {
    const first = setup({ sessions: ['s1', 's2'] });
    const alert = raiseSessionAlert(first.deps, 's2', 'stuck', 100);

    const projection = createProjection(first.store);
    projection.dispatch({ type: 'store-loaded', tmuxNames: { ...first.store.read().tmuxNames } });
    for (const id of ['s1', 's2'])
      projection.dispatch({ type: 'session-registered', id, tmuxName: id, cwd: `/work/${id}` });
    expect(projection.sessions().map((s) => s.alert)).toEqual([null, null]);

    replayAlerts({ projection });

    const byId = Object.fromEntries(projection.sessions().map((s) => [s.id, s.alert]));
    expect(byId).toEqual({ s1: null, s2: alert });
  });
});
