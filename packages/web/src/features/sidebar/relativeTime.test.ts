import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relativeTime';

const NOW = 1_000_000_000;

describe('formatRelativeTime', () => {
  it('reports under a minute as just now', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('just now');
  });

  it('reports minutes once a full minute has elapsed', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
  });

  it('reports hours once a full hour has elapsed', () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
  });

  it('reports days once a full day has elapsed', () => {
    expect(formatRelativeTime(NOW - 19 * 86_400_000, NOW)).toBe('19d ago');
  });

  it('never reports a negative elapsed time for a future timestamp', () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('just now');
  });
});
