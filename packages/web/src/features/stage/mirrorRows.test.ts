import { describe, expect, it } from 'vitest';
import { resolveRowMirror } from './mirrorRows';

describe('resolveRowMirror', () => {
  it('returns null when the rows already match', () => {
    expect(resolveRowMirror([400, 600], [400, 600], [400, 600])).toBeNull();
  });

  it('mirrors the top row onto the bottom when the top row diverged from the baseline', () => {
    expect(resolveRowMirror([300, 700], [400, 600], [400, 600])).toEqual({
      target: 'bottom',
      widths: [300, 700],
    });
  });

  it('mirrors the bottom row onto the top when the bottom row diverged from the baseline', () => {
    expect(resolveRowMirror([400, 600], [250, 750], [400, 600])).toEqual({
      target: 'top',
      widths: [250, 750],
    });
  });
});
