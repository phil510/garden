import { describe, expect, it } from 'vitest';
import { nextReconnectDelayMs } from './eventSocket';

describe('nextReconnectDelayMs', () => {
  it('starts at the initial delay on the first attempt', () => {
    expect(nextReconnectDelayMs(0)).toBe(250);
  });

  it('doubles with each attempt', () => {
    expect(nextReconnectDelayMs(1)).toBe(500);
    expect(nextReconnectDelayMs(2)).toBe(1000);
    expect(nextReconnectDelayMs(3)).toBe(2000);
  });

  it('caps at the maximum delay rather than growing without bound', () => {
    expect(nextReconnectDelayMs(10)).toBe(10_000);
    expect(nextReconnectDelayMs(100)).toBe(10_000);
  });
});
