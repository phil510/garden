import type { RepoEntry } from '@garden/shared';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { getFileTree, listRepos } from '../../api/client';
import { chooseStartupRoot, type FilePanelTab } from '../../state/filePanelPersistence';
import { useLocalStore } from '../../state/localStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { getCachedRepoList, setCachedRepoList } from '../sidebar/repoListCache';
import { mostSpecificEntry } from './projectPaths';
import { TreeRow } from './TreeRow';
import { visibleTreeRows } from './treeRows';
import { useFileTree } from './useFileTree';
import { Viewer } from './Viewer';
import './filetree.css';

const EMPTY_EXPANDED: readonly string[] = [];

function repoLabel(repo: RepoEntry): string {
  const hint = repo.isWorktree ? `worktree${repo.branch ? `: ${repo.branch}` : ''}` : repo.branch;
  return hint ? `${repo.name} (${hint})` : repo.name;
}

/** Toggleable right panel that browses one `/repos` project at a time. The shown root changes
 *  only through the project dropdown, the jump button or a terminal `path:line` click; session
 *  focus feeds the jump button's target and nothing else. */
export function FilePanel() {
  const slots = useUiStore((state) => state.uiState.slots);
  const focusedSlot = useUiStore((state) => state.uiState.focusedSlot);
  const hydrated = useUiStore((state) => state.hydrated);
  const focusedId = slots[focusedSlot] ?? null;
  const focusedCwd = useSessionStore((state) =>
    focusedId === null ? null : (state.sessions[focusedId]?.cwd ?? null),
  );

  const filePanel = useLocalStore((state) => state.filePanel);
  const fsRefreshEpoch = useLocalStore((state) => state.fsRefreshEpoch);
  const connectionEpoch = useLocalStore((state) => state.connectionEpoch);
  const setPanelRoot = useLocalStore((state) => state.setPanelRoot);
  const toggleExpandedPath = useLocalStore((state) => state.toggleExpandedPath);
  const setOpenFile = useLocalStore((state) => state.setOpenFile);
  const setPanelTab = useLocalStore((state) => state.setPanelTab);
  const setShowGitignored = useLocalStore((state) => state.setShowGitignored);
  const requestOpenFile = useLocalStore((state) => state.requestOpenFile);
  const bumpFsRefresh = useLocalStore((state) => state.bumpFsRefresh);

  const { root, showGitignored } = filePanel;
  const rootState = root === null ? undefined : filePanel.byRoot[root];
  const expanded = rootState?.expanded ?? EMPTY_EXPANDED;
  const openFilePath = rootState?.openFile ?? null;

  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepoList);
  useEffect(() => {
    let cancelled = false;
    listRepos()
      .then((response) => {
        if (cancelled) return;
        setCachedRepoList(response.repos);
        setRepos(response.repos);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connectionEpoch]);

  // Picks the first root once both the repo list and the focused session are known. Marked done
  // only when a root was applied or the stored one confirmed listed, so an empty first `/repos`
  // answer doesn't leave the panel rootless for good. Later focus changes never re-run it.
  const startupDone = useRef(false);
  const chooseRoot = useEffectEvent((listed: RepoEntry[]) => {
    const chosen = chooseStartupRoot(root, listed, focusedCwd);
    if (chosen === null) return;
    if (chosen !== root) setPanelRoot(chosen);
    startupDone.current = true;
  });
  useEffect(() => {
    if (startupDone.current || !hydrated || repos === null) return;
    chooseRoot(repos);
  }, [hydrated, repos]);

  const jumpTarget =
    focusedCwd === null || repos === null ? null : mostSpecificEntry(repos, focusedCwd);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') bumpFsRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [bumpFsRefresh]);

  // Without a root there is nowhere to persist the tab, so a session-fallback file's tab switch
  // lives here.
  const [localTab, setLocalTab] = useState<FilePanelTab>('files');
  const activeTab = rootState?.tab ?? (root === null ? localTab : 'files');
  const setTab = useCallback(
    (tab: FilePanelTab) => {
      if (root === null) setLocalTab(tab);
      else setPanelTab(root, tab);
    },
    [root, setPanelTab],
  );

  const [shownPath, setShownPath] = useState<string | null>(null);

  const loadDir = useCallback(
    (path: string, refresh?: string) =>
      root === null ? Promise.reject(new Error('no root')) : getFileTree({ root }, path, refresh),
    [root],
  );
  const { childrenByPath, loadPath } = useFileTree(root, expanded, fsRefreshEpoch, loadDir);

  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const rows =
    root === null
      ? []
      : visibleTreeRows(childrenByPath[''], childrenByPath, expandedSet, showGitignored);

  function toggleDir(path: string) {
    if (root === null) return;
    const willExpand = !expandedSet.has(path);
    toggleExpandedPath(root, path);
    if (willExpand && childrenByPath[path] === undefined) loadPath(path);
  }

  function openFile(path: string) {
    if (root === null) return;
    setOpenFile(root, path);
    setPanelTab(root, 'editor');
    // Also tells the viewer to drop a session-sourced file when this path is already open.
    requestOpenFile({ kind: 'root', root }, path, null);
  }

  const onSessionFileOpened = useCallback(() => setTab('editor'), [setTab]);

  return (
    <>
      <div className="fp-header">
        <select
          className="fp-project"
          aria-label="Project"
          value={root ?? ''}
          title={root ?? undefined}
          onChange={(event) => setPanelRoot(event.target.value)}
        >
          {root === null && (
            <option value="" disabled>
              Select a project
            </option>
          )}
          {repos?.map((repo) => (
            <option key={repo.path} value={repo.path}>
              {repoLabel(repo)}
            </option>
          ))}
        </select>
        <button
          className="ghost icon-btn"
          title="Jump to the focused session's project"
          aria-label="Jump to the focused session's project"
          disabled={jumpTarget === null}
          onClick={() => {
            if (jumpTarget !== null) setPanelRoot(jumpTarget.path);
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      </div>
      <div className="fp-tabs">
        <button
          className={`fp-tab${activeTab === 'files' ? ' active' : ''}`}
          onClick={() => setTab('files')}
        >
          Files
        </button>
        <button
          className={`fp-tab${activeTab === 'editor' ? ' active' : ''}`}
          title={shownPath ?? undefined}
          onClick={() => setTab('editor')}
        >
          {shownPath ?? 'Editor'}
        </button>
      </div>
      <div className="fp-tab-content" hidden={activeTab !== 'files'}>
        <div className="fp-tree-toolbar">
          <span className="upper faint">Files</span>
          <button
            className={`toggle-pill${showGitignored ? ' on' : ''}`}
            onClick={() => setShowGitignored(!showGitignored)}
          >
            <span className="dot" />
            <span>Show gitignored</span>
          </button>
        </div>
        <div className="fp-tree">
          {root === null ? (
            <div className="fp-none">No project selected.</div>
          ) : (
            rows.map((row) => (
              <TreeRow
                key={row.entry.path}
                row={row}
                selected={row.entry.path === openFilePath}
                onToggleDir={toggleDir}
                onOpenFile={openFile}
              />
            ))
          )}
        </div>
      </div>
      <div className="fp-tab-content" hidden={activeTab !== 'editor'}>
        <Viewer
          root={root}
          openFile={openFilePath}
          onSessionFileOpened={onSessionFileOpened}
          onShownPathChange={setShownPath}
        />
      </div>
    </>
  );
}
