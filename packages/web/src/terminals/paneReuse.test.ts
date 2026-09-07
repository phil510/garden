import { describe, expect, it } from 'vitest';
import { shouldReusePane } from './paneReuse.js';

describe('shouldReusePane', () => {
  it('reuses a pane whose epoch matches the requested epoch', () => {
    expect(shouldReusePane(3, 3)).toBe(true);
  });

  it('rebuilds a pane left over from an earlier connection epoch', () => {
    expect(shouldReusePane(0, 1)).toBe(false);
  });
});
