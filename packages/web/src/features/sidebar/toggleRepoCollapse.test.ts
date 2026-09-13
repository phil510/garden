import { aSession } from '@garden/shared/fixtures';
import type { SessionMap, UiState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { groupSessions } from './groupSessions';
import { toggleRepoCollapse } from './toggleRepoCollapse';

const uiState: Pick<UiState, 'groupOrder' | 'pinnedRepos' | 'collapsedRepos'> = {
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
};

const asMap = (...sessions: ReturnType<typeof aSession>[]): SessionMap =>
  Object.fromEntries(sessions.map((s) => [s.id, s]));

describe('toggleRepoCollapse', () => {
  it('toggles a group from collapsed to expanded and back, starting from the default', () => {
    const session = aSession({ id: 'sid-1', repoRoot: '/repo' });
    const sessions = asMap(session);

    const [initial] = groupSessions(sessions, uiState);
    expect(initial?.collapsed).toBe(true);

    const expanded = toggleRepoCollapse(uiState.collapsedRepos, '/repo');
    const [afterExpand] = groupSessions(sessions, { ...uiState, collapsedRepos: expanded });
    expect(afterExpand?.collapsed).toBe(false);

    const recollapsed = toggleRepoCollapse(expanded, '/repo');
    const [afterRecollapse] = groupSessions(sessions, { ...uiState, collapsedRepos: recollapsed });
    expect(afterRecollapse?.collapsed).toBe(true);
  });

  it('toggling one repo leaves another repo unaffected', () => {
    const first = aSession({ id: 'sid-1', repoRoot: '/first' });
    const second = aSession({ id: 'sid-2', repoRoot: '/second' });
    const sessions = asMap(first, second);

    const expanded = toggleRepoCollapse(uiState.collapsedRepos, '/first');
    const groups = groupSessions(sessions, { ...uiState, collapsedRepos: expanded });

    expect(groups.find((g) => g.repoRoot === '/first')?.collapsed).toBe(false);
    expect(groups.find((g) => g.repoRoot === '/second')?.collapsed).toBe(true);
  });
});
