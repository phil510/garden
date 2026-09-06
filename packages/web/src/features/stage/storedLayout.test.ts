import { describe, expect, it } from 'vitest';
import { presetLayout } from './presetLayout';
import { stageLayout } from './storedLayout';

const wanted = presetLayout('two-across', ['sid-a', 'sid-b']);

describe('stageLayout', () => {
  it('keeps a stored layout describing the same panes', () => {
    const stored = { ...presetLayout('two-across', ['sid-a', 'sid-b']), tag: 'dragged' };

    expect(stageLayout(wanted, stored)).toBe(stored);
  });

  it('falls back to the preset default when the stored layout holds other sessions', () => {
    const stored = presetLayout('two-across', ['sid-a', 'sid-c']);

    expect(stageLayout(wanted, stored)).toBe(wanted);
  });

  it('falls back to the preset default when the stored layout has a different pane count', () => {
    const stored = presetLayout('grid-2x2', ['sid-a', 'sid-b', null, null]);

    expect(stageLayout(wanted, stored)).toBe(wanted);
  });

  it.each([null, 'a string', {}, { grid: {} }, { grid: {}, panels: [] }])(
    'falls back to the preset default for %o',
    (stored) => {
      expect(stageLayout(wanted, stored)).toBe(wanted);
    },
  );
});
