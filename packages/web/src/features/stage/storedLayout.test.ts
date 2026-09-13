import { describe, expect, it } from 'vitest';
import { presetLayout } from './presetLayout';
import { stageLayout } from './storedLayout';

const wanted = presetLayout('two-across', ['sid-a', 'sid-b']);

describe('stageLayout', () => {
  it('keeps a stored layout describing the same panes', () => {
    const stored = { ...presetLayout('two-across', ['sid-a', 'sid-b']), tag: 'dragged' };

    expect(stageLayout(wanted, stored)).toEqual(stored);
  });

  it('falls back to the preset default when the stored layout holds other sessions', () => {
    const stored = presetLayout('two-across', ['sid-a', 'sid-c']);

    expect(stageLayout(wanted, stored)).toBe(wanted);
  });

  it('falls back to the preset default when the stored layout has a different pane count', () => {
    const stored = presetLayout('grid-2x2', ['sid-a', 'sid-b', null, null]);

    expect(stageLayout(wanted, stored)).toBe(wanted);
  });

  it('falls back to the preset default when the stored layout splits along the other axis', () => {
    const stored = presetLayout('two-stacked', ['sid-a', 'sid-b']);

    expect(stageLayout(wanted, stored)).toBe(wanted);
  });

  it('keeps a pre-fix grid-2x2 blob whose two rows have different column splits', () => {
    // Before this change, nothing kept the two rows' column widths in sync, so a real stored
    // blob could easily have lopsided rows. `fits()` only checks root orientation and the
    // panel-id set, so a blob like this must keep loading unchanged, exactly as it did before.
    const grid2x2Wanted = presetLayout('grid-2x2', ['sid-a', 'sid-b', 'sid-c', 'sid-d']);
    const lopsided = {
      ...grid2x2Wanted,
      grid: {
        ...grid2x2Wanted.grid,
        root: {
          ...grid2x2Wanted.grid.root,
          data: [
            {
              type: 'branch' as const,
              size: 500,
              data: [
                {
                  type: 'leaf' as const,
                  size: 300,
                  data: { id: 'group-sid-a', views: ['sid-a'], activeView: 'sid-a' },
                },
                {
                  type: 'leaf' as const,
                  size: 700,
                  data: { id: 'group-sid-b', views: ['sid-b'], activeView: 'sid-b' },
                },
              ],
            },
            {
              type: 'branch' as const,
              size: 500,
              data: [
                {
                  type: 'leaf' as const,
                  size: 500,
                  data: { id: 'group-sid-c', views: ['sid-c'], activeView: 'sid-c' },
                },
                {
                  type: 'leaf' as const,
                  size: 500,
                  data: { id: 'group-sid-d', views: ['sid-d'], activeView: 'sid-d' },
                },
              ],
            },
          ],
        },
      },
    };

    expect(stageLayout(grid2x2Wanted, lopsided)).toEqual(lopsided);
  });

  it('drops the maximised node so a reload never restores a stage with a pane hidden', () => {
    const stored = { ...wanted, grid: { ...wanted.grid, maximizedNode: { location: [0] } } };

    expect(stageLayout(wanted, stored).grid).not.toHaveProperty('maximizedNode');
  });

  it.each([null, 'a string', {}, { grid: {} }, { grid: {}, panels: [] }])(
    'falls back to the preset default for %o',
    (stored) => {
      expect(stageLayout(wanted, stored)).toBe(wanted);
    },
  );
});
