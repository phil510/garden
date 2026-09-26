import { describe, expect, it } from 'vitest';
import { reorderSwarms } from './reorderSwarms';

describe('reorderSwarms', () => {
  it('moves the dragged swarm to the position it was dropped on', () => {
    const result = reorderSwarms(['x', 'y', 'z'], 'z', 'x');
    expect(result).toEqual(['z', 'x', 'y']);
  });

  it('is a no-op when dropped on its own position', () => {
    const result = reorderSwarms(['x', 'y', 'z'], 'y', 'y');
    expect(result).toEqual(['x', 'y', 'z']);
  });
});
