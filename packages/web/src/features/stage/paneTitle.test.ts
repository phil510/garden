import { aSession } from '@garden/shared/fixtures';
import type { SessionPlacement, SwarmRecord } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { paneTitle, swarmChipFor } from './paneTitle';

describe('paneTitle', () => {
  it('prefixes the title with the repo root folder name when the repo root is known', () => {
    const session = aSession({ repoRoot: '/Users/dev/garden', title: 'Fix the bug' });
    expect(paneTitle(session)).toBe('garden: Fix the bug');
  });

  it('falls back to the cwd when the session has no title yet', () => {
    const session = aSession({
      repoRoot: '/Users/dev/garden',
      title: null,
      cwd: '/Users/dev/garden',
    });
    expect(paneTitle(session)).toBe('garden: /Users/dev/garden');
  });

  it('omits the project prefix entirely when the repo root is unknown', () => {
    const session = aSession({ repoRoot: null, title: 'Fix the bug' });
    expect(paneTitle(session)).toBe('Fix the bug');
  });
});

describe('swarmChipFor', () => {
  const swarms: SwarmRecord[] = [{ id: 'swarm-1', name: 'Refactor sidebar', archived: false }];

  it('returns the chip for a session belonging to a known swarm', () => {
    const session = aSession({ id: 'sess-1' });
    const placements: Record<string, SessionPlacement> = { 'sess-1': { swarmId: 'swarm-1' } };
    expect(swarmChipFor(session, placements, swarms)).toEqual({
      id: 'swarm-1',
      name: 'Refactor sidebar',
    });
  });

  it('returns null for a solo session', () => {
    const session = aSession({ id: 'sess-1' });
    expect(swarmChipFor(session, {}, swarms)).toBeNull();
  });

  it('returns null when the resolved swarm id has no matching SwarmRecord', () => {
    const session = aSession({ id: 'sess-1' });
    const placements: Record<string, SessionPlacement> = { 'sess-1': { swarmId: 'gone' } };
    expect(swarmChipFor(session, placements, swarms)).toBeNull();
  });
});
