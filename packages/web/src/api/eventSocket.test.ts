import { describe, expect, it } from 'vitest';
import { eventCloseDisposition, nextReconnectDelayMs } from './eventSocket';

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

describe('eventCloseDisposition', () => {
  it('is terminal on the deliberate-shutdown code', () => {
    expect(eventCloseDisposition(4100)).toBe('terminal');
  });

  it('reconnects on every other code, including a plain dropped connection', () => {
    expect(eventCloseDisposition(1000)).toBe('reconnect');
    expect(eventCloseDisposition(1006)).toBe('reconnect');
    expect(eventCloseDisposition(1001)).toBe('reconnect');
    expect(eventCloseDisposition(1011)).toBe('reconnect');
  });
});
