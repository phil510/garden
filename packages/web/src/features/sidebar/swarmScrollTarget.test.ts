import { describe, expect, it } from 'vitest';
import { resolveSwarmScrollAction } from './swarmScrollTarget';

describe('resolveSwarmScrollAction', () => {
  it('is idle when no swarm is queued', () => {
    expect(resolveSwarmScrollAction(null, false, ['s1'])).toBe('idle');
  });

  it('expands Finished when the target is inside it and collapsed', () => {
    expect(resolveSwarmScrollAction('s1', false, ['s1', 's2'])).toBe('expand-finished');
  });

  it('scrolls directly when the target is not inside Finished', () => {
    expect(resolveSwarmScrollAction('s1', false, ['s2'])).toBe('scroll');
  });

  it('scrolls directly when Finished is already open', () => {
    expect(resolveSwarmScrollAction('s1', true, ['s1'])).toBe('scroll');
  });
});
