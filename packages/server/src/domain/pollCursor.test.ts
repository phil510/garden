import { describe, expect, it } from 'vitest';
import {
  checkTransitions,
  conflictTransition,
  emptyCursor,
  emptyItems,
  newListItems,
  readCursor,
  statusTransitions,
} from './pollCursor.js';

const T0 = 1_000_000;
const item = (id: number, at: number) => ({ id, at });
const effective = (i: { at: number }) => i.at;

describe('newListItems', () => {
  it('reports nothing that predates the watch on a first poll, but records it as seen', () => {
    const items = [item(1, T0 - 10), item(2, T0 - 5)];

    const result = newListItems(items, [], true, T0, effective);

    expect(result.fresh).toEqual([]);
    expect(result.seen).toEqual([1, 2]);
  });

  it('reports activity between creation and the first poll', () => {
    const items = [item(1, T0 - 10), item(2, T0 + 5)];

    expect(newListItems(items, [], true, T0, effective).fresh).toEqual([item(2, T0 + 5)]);
  });

  it('reports activity stamped in the same whole second as the watch was created', () => {
    const created = T0 + 300;
    const items = [item(1, T0 - 1000), item(2, T0)];

    expect(newListItems(items, [], true, created, effective).fresh).toEqual([item(2, T0)]);
  });

  it('reports every unseen item after the first poll, whatever its timestamp', () => {
    const result = newListItems([item(1, 0), item(2, 0)], [1], false, T0, effective);

    expect(result.fresh).toEqual([item(2, 0)]);
  });

  it('reports a review with a lower id than one already seen once it is submitted', () => {
    // id 3 was started before id 7 but only became visible after id 7 was seen.
    const result = newListItems([item(7, T0 + 1), item(3, T0 + 9)], [7], false, T0, effective);

    expect(result.fresh).toEqual([item(3, T0 + 9)]);
  });

  it('neither hides nor re-reports comments when an earlier one is deleted and pages shift', () => {
    const result = newListItems(
      [item(2, 0), item(3, 0), item(4, 0)],
      [1, 2, 3],
      false,
      T0,
      effective,
    );

    expect(result.fresh).toEqual([item(4, 0)]);
    expect(result.seen).toEqual([1, 2, 3, 4]);
  });

  it('reports nothing for an edit, which changes the page ETag but not the ids', () => {
    expect(newListItems([item(1, 0)], [1], false, T0, effective).fresh).toEqual([]);
  });
});

describe('checkTransitions', () => {
  const run = (id: number, conclusion: string | null, completedAt: number | null) => ({
    id,
    name: `check-${String(id)}`,
    conclusion,
    completedAt,
  });

  it('records runs that finished before the watch without reporting them', () => {
    const result = checkTransitions([run(1, 'failure', T0 - 1)], {}, T0, 'sha1');

    expect(result.transitions).toEqual([]);
    expect(result.reported).toEqual({ '1': `failure@${String(T0 - 1)}` });
  });

  it('reports a run that completed in the second the watch was created', () => {
    const result = checkTransitions([run(1, 'failure', T0)], {}, T0 + 300, 'sha1');

    expect(result.transitions).toEqual([
      {
        kind: 'check-run',
        id: 1,
        name: 'check-1',
        conclusion: 'failure',
        outcome: 'failed',
        at: T0,
        headSha: 'sha1',
      },
    ]);
  });

  it('reports a run first seen in progress that later fails, once', () => {
    const first = checkTransitions([run(1, null, null)], {}, T0, 'sha1');
    const second = checkTransitions([run(1, 'failure', T0 + 5)], first.reported, T0, 'sha1');
    const third = checkTransitions([run(1, 'failure', T0 + 5)], second.reported, T0, 'sha1');

    expect(first.transitions).toEqual([]);
    expect(second.transitions).toMatchObject([{ name: 'check-1', outcome: 'failed', at: T0 + 5 }]);
    expect(third.transitions).toEqual([]);
  });

  it('reports a run re-run in place with a new completion time', () => {
    const first = checkTransitions([run(1, 'failure', T0 + 5)], {}, T0, 'sha1');

    const again = checkTransitions([run(1, 'failure', T0 + 50)], first.reported, T0, 'sha1');

    expect(again.transitions).toHaveLength(1);
  });

  it('reports passes as passed and ignores skipped and cancelled runs', () => {
    const result = checkTransitions(
      [run(1, 'success', T0 + 1), run(2, 'skipped', T0 + 1), run(3, 'cancelled', T0 + 1)],
      {},
      T0,
      'sha1',
    );

    expect(result.transitions).toEqual([
      {
        kind: 'check-run',
        id: 1,
        name: 'check-1',
        conclusion: 'success',
        outcome: 'passed',
        at: T0 + 1,
        headSha: 'sha1',
      },
    ]);
  });
});

describe('statusTransitions', () => {
  const status = (state: string, updatedAt: number) => ({ context: 'ci/x', state, updatedAt });

  it('reports pending moving to error once, and a repeated failure with a new timestamp again', () => {
    const pending = statusTransitions([status('pending', T0 + 1)], {}, T0, 'sha1');
    const error = statusTransitions([status('error', T0 + 2)], pending.reported, T0, 'sha1');
    const failure = statusTransitions([status('failure', T0 + 3)], error.reported, T0, 'sha1');
    const failureAgain = statusTransitions(
      [status('failure', T0 + 4)],
      failure.reported,
      T0,
      'sha1',
    );

    expect(pending.transitions).toEqual([]);
    expect(error.transitions).toEqual([
      {
        kind: 'status',
        name: 'ci/x',
        state: 'error',
        outcome: 'failed',
        at: T0 + 2,
        headSha: 'sha1',
      },
    ]);
    expect(failure.transitions).toHaveLength(1);
    expect(failureAgain.transitions).toHaveLength(1);
  });

  it('does not report a status already failing when the watch was created', () => {
    expect(statusTransitions([status('failure', T0 - 1)], {}, T0, 'sha1').transitions).toEqual([]);
  });
});

describe('conflictTransition', () => {
  it('takes the first known reading as a baseline, even a conflicting one', () => {
    expect(conflictTransition(null, false)).toEqual({ fires: false, next: false });
    expect(conflictTransition(null, true)).toEqual({ fires: false, next: true });
  });

  it('fires when a mergeable PR becomes conflicting', () => {
    expect(conflictTransition(true, false)).toEqual({ fires: true, next: false });
  });

  it('keeps the previous reading while GitHub is computing, so a conflict does not re-fire', () => {
    const computing = conflictTransition(false, null);

    expect(computing).toEqual({ fires: false, next: false });
    expect(conflictTransition(computing.next, false).fires).toBe(false);
  });
});

describe('readCursor', () => {
  it('round-trips a cursor through JSON', () => {
    const cursor = emptyCursor();

    expect(readCursor(JSON.parse(JSON.stringify(cursor)))).toEqual(cursor);
  });

  describe('a cursor persisted before items were recorded', () => {
    const legacy = (written: Record<string, unknown>) => {
      const empty: Record<string, unknown> = { ...emptyCursor().written };
      delete empty['items'];
      return JSON.parse(
        JSON.stringify({
          ...emptyCursor(),
          written: { ...empty, ...written },
          fresh: empty,
        }),
      ) as unknown;
    };

    it('gets empty items for an empty tally and unknown items for a counted one', () => {
      const cursor = readCursor(legacy({ comments: 2 }));

      expect(cursor?.written.items).toBeNull();
      expect(cursor?.fresh.items).toEqual(emptyItems());
    });

    it('is normalised without writing into the value passed in', () => {
      const persisted = legacy({ comments: 2 });
      const before = JSON.stringify(persisted);

      readCursor(persisted);

      expect(JSON.stringify(persisted)).toBe(before);
    });
  });

  it('keeps unknown items as null and rejects malformed items', () => {
    const unknown = { ...emptyCursor(), written: { ...emptyCursor().written, items: null } };
    const malformed = {
      ...emptyCursor(),
      fresh: { ...emptyCursor().fresh, items: { reviews: [] } },
    };

    expect(readCursor(JSON.parse(JSON.stringify(unknown)))?.written.items).toBeNull();
    expect(readCursor(malformed)).toBeNull();
  });

  it.each([
    null,
    undefined,
    'x',
    { v: 2 },
    { ...emptyCursor(), reviews: { etags: [1], seen: [] } },
  ])('rejects %j', (value) => {
    expect(readCursor(value)).toBeNull();
  });
});
