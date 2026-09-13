import { useEffect, useState, type MouseEvent } from 'react';
import type { RepoEntry } from '@garden/shared';
import { createSession, listRepos } from '../../api/client';
import { reportCommandFailure } from '../../api/reportCommandFailure';
import { buildPickerGroups } from './pickerItems';
import { getCachedRepoList, setCachedRepoList } from './repoListCache';

interface NewSessionModalProps {
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function NewSessionModal({ onClose, onCreated }: NewSessionModalProps) {
  // Seeded from the cache left by a prior open, so a second mount renders the list immediately
  // instead of a loading state — see repoListCache.ts for why this isn't in localStore.
  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepoList);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  // Always refetch on mount, so the list never goes stale.
  useEffect(() => {
    let cancelled = false;
    listRepos()
      .then((response) => {
        if (!cancelled) {
          setCachedRepoList(response.repos);
          setRepos(response.repos);
        }
      })
      .catch((error: unknown) => {
        reportCommandFailure(error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function onOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  function pick(path: string) {
    createSession(path)
      .then((result) => onCreated(result.id))
      .catch(reportCommandFailure);
  }

  // A failed refetch must not leave a previously-cached, now-unverified list on screen and
  // clickable — hide it behind the error banner above rather than trusting stale data.
  const groups = failed || repos === null ? [] : buildPickerGroups(repos, query);

  return (
    <div className="modal-overlay" onClick={onOverlayClick}>
      <div className="modal-box">
        <div className="modal-search">
          <input
            type="text"
            placeholder="Filter repos and worktrees…"
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="modal-list">
          {failed && <div className="modal-empty">Could not load repos.</div>}
          {!failed && repos === null && <div className="modal-empty">Loading repos…</div>}
          {!failed && repos !== null && groups.length === 0 && (
            <div className="modal-empty">No repos or worktrees match &quot;{query}&quot;.</div>
          )}
          {groups.map((group) => (
            <div key={group.repoName}>
              <div className="modal-group-label upper">{group.repoName}</div>
              {group.items.map((item) => (
                <div key={item.path} className="modal-item" onClick={() => pick(item.path)}>
                  <span className="mi-icon">
                    {item.isWorktree ? <WorktreeIcon /> : <RepoIcon />}
                  </span>
                  <span className="mi-name">{item.label}</span>
                  <span className="mi-path">{item.path}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RepoIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function WorktreeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5V15.5M8.3 6.8 15.7 8.2" />
    </svg>
  );
}
