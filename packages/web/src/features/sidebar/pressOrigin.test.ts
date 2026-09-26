import { describe, expect, it } from 'vitest';
import { pressStartedInMenu } from './pressOrigin.js';

function elementWithClosest(matches: boolean) {
  return { closest: () => (matches ? {} : null) };
}

describe('pressStartedInMenu', () => {
  it('is true when the press target is inside the context menu', () => {
    expect(pressStartedInMenu(elementWithClosest(true))).toBe(true);
  });

  it('is false when the press target is outside the context menu', () => {
    expect(pressStartedInMenu(elementWithClosest(false))).toBe(false);
  });

  it('is false when there is no press target', () => {
    expect(pressStartedInMenu(null)).toBe(false);
  });
});
