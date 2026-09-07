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
