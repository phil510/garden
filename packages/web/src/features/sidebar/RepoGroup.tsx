import type { KeyboardEvent } from 'react';
import type { SidebarGroup } from './groupSessions';

interface RepoGroupProps {
  group: SidebarGroup;
  onToggleCollapse: (repoRoot: string) => void;
}

export function RepoGroup({ group, onToggleCollapse }: RepoGroupProps) {
  function toggle() {
    onToggleCollapse(group.repoRoot);
  }

  function onHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  }

  return (
    <div className="repo-group">
      <div
        className={`repo-header${group.collapsed ? ' collapsed' : ''}`}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={onHeaderKeyDown}
      >
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="repo-name">{group.repoName}</span>
        {group.attention && <span className="attn-badge" title="Needs attention" />}
        <span className="repo-count mono">{group.liveCount} live</span>
      </div>
      <div className={`repo-rows${group.collapsed ? ' collapsed' : ''}`} />
    </div>
  );
}
