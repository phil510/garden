import { describe, expect, it } from 'vitest';
import { toggleSwarmCollapse } from './toggleSwarmCollapse';

describe('toggleSwarmCollapse', () => {
  it('toggles a swarm from expanded to collapsed and back, starting from the default', () => {
    const collapsed = toggleSwarmCollapse([], 'swarm-1');
    expect(collapsed).toEqual(['swarm-1']);

    const expanded = toggleSwarmCollapse(collapsed, 'swarm-1');
    expect(expanded).toEqual([]);
  });

  it('toggling one swarm leaves another swarm unaffected', () => {
    const result = toggleSwarmCollapse(['swarm-2'], 'swarm-1');
    expect(result).toEqual(['swarm-2', 'swarm-1']);
    expect(toggleSwarmCollapse(result, 'swarm-2')).toEqual(['swarm-1']);
  });
});
