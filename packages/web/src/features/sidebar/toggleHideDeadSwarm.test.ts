import { describe, expect, it } from 'vitest';
import { toggleHideDeadSwarm } from './toggleHideDeadSwarm';

describe('toggleHideDeadSwarm', () => {
  it('toggles a swarm from showing dead sessions to hiding them and back, starting from the default', () => {
    const hidden = toggleHideDeadSwarm([], 'swarm-1');
    expect(hidden).toEqual(['swarm-1']);

    const shown = toggleHideDeadSwarm(hidden, 'swarm-1');
    expect(shown).toEqual([]);
  });

  it('toggling one swarm leaves another swarm unaffected', () => {
    const result = toggleHideDeadSwarm(['swarm-2'], 'swarm-1');
    expect(result).toEqual(['swarm-2', 'swarm-1']);
    expect(toggleHideDeadSwarm(result, 'swarm-2')).toEqual(['swarm-1']);
  });
});
