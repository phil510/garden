import { aSession } from '@garden/shared/fixtures';
import type { SessionMap, UiState } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { groupSessions } from './groupSessions';
import { toggleHideDeadRepo } from './toggleHideDeadRepo';

const uiState: Pick<UiState, 'groupOrder' | 'pinnedRepos' | 'collapsedRepos' | 'hideDeadRepos'> = {
  groupOrder: [],
  pinnedRepos: [],
  collapsedRepos: [],
  hideDeadRepos: [],
};

const asMap = (...sessions: ReturnType<typeof aSession>[]): SessionMap =>
  Object.fromEntries(sessions.map((s) => [s.id, s]));

describe('toggleHideDeadRepo', () => {
  it('toggles a group from showing dead sessions to hiding them and back, starting from the default', () => {
    const session = aSession({ id: 'sid-1', repoRoot: '/repo' });
    const sessions = asMap(session);

    const [initial] = groupSessions(sessions, uiState);
    expect(initial?.hideDead).toBe(false);

    const hidden = toggleHideDeadRepo(uiState.hideDeadRepos, '/repo');
    const [afterHide] = groupSessions(sessions, { ...uiState, hideDeadRepos: hidden });
    expect(afterHide?.hideDead).toBe(true);

    const shown = toggleHideDeadRepo(hidden, '/repo');
    const [afterShow] = groupSessions(sessions, { ...uiState, hideDeadRepos: shown });
    expect(afterShow?.hideDead).toBe(false);
  });

  it('toggling one repo leaves another repo unaffected', () => {
    const first = aSession({ id: 'sid-1', repoRoot: '/first' });
    const second = aSession({ id: 'sid-2', repoRoot: '/second' });
    const sessions = asMap(first, second);

    const hidden = toggleHideDeadRepo(uiState.hideDeadRepos, '/first');
    const groups = groupSessions(sessions, { ...uiState, hideDeadRepos: hidden });

    expect(groups.find((g) => g.repoRoot === '/first')?.hideDead).toBe(true);
    expect(groups.find((g) => g.repoRoot === '/second')?.hideDead).toBe(false);
  });
});
