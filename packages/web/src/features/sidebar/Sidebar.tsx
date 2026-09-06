import { updateUiState } from '../../api/client';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { groupSessions } from './groupSessions';
import { RepoGroup } from './RepoGroup';
import './sidebar.css';

export function Sidebar() {
  const sessions = useSessionStore((state) => state.sessions);
  const uiState = useUiStore((state) => state.uiState);
  const groups = groupSessions(sessions, uiState);

  function toggleCollapse(repoRoot: string) {
    const collapsedRepos = uiState.collapsedRepos.includes(repoRoot)
      ? uiState.collapsedRepos.filter((root) => root !== repoRoot)
      : [...uiState.collapsedRepos, repoRoot];
    void updateUiState({ collapsedRepos });
  }

  return (
    <>
      {groups.map((group) => (
        <RepoGroup key={group.repoRoot} group={group} onToggleCollapse={toggleCollapse} />
      ))}
    </>
  );
}
