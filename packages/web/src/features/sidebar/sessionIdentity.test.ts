import { describe, expect, it } from 'vitest';
import { sessionIdentityLabel } from './sessionIdentity';

describe('sessionIdentityLabel', () => {
  it('pairs the Claude-side name with the id when the name is known', () => {
    expect(sessionIdentityLabel('garden-7a', 'a1b2c3d4-0000-4000-8000-000000000001')).toBe(
      'garden-7a (a1b2c3d4-0000-4000-8000-000000000001)',
    );
  });

  it('degrades to the bare id when the name is not resolvable', () => {
    expect(sessionIdentityLabel(null, 'a1b2c3d4-0000-4000-8000-000000000001')).toBe(
      'a1b2c3d4-0000-4000-8000-000000000001',
    );
  });
});
