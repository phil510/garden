import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFileTree } from '../../api/client';
import { useLocalStore } from '../../state/localStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { TreeRow } from './TreeRow';
import { visibleTreeRows } from './treeRows';
import { useFileTree } from './useFileTree';
import { Viewer } from './Viewer';
import './filetree.css';

const EMPTY_EXPANDED: readonly string[] = [];

/** Toggleable right panel bound to the focused pane's session, rooted at that session's
 *  cwd. Directories are fetched lazily as they are expanded and refreshed on the focused
 *  session's own activity; both live in `useFileTree`. */
export function FilePanel() {
  const slots = useUiStore((state) => state.uiState.slots);
  const focusedSlot = useUiStore((state) => state.uiState.focusedSlot);
  const sessionId = slots[focusedSlot] ?? null;
  const session = useSessionStore((state) =>
    sessionId === null ? undefined : state.sessions[sessionId],
  );

  // The narrow signal that the session did something a file tree could have changed under.
  const lastActivity = session?.lastActivity ?? null;

  const expandedPaths = useLocalStore((state) =>
    sessionId === null ? EMPTY_EXPANDED : (state.expandedPaths[sessionId] ?? EMPTY_EXPANDED),
  );
  const toggleExpandedPath = useLocalStore((state) => state.toggleExpandedPath);
  const requestOpenFile = useLocalStore((state) => state.requestOpenFile);
  const openFileRequest = useLocalStore((state) => state.openFileRequest);

  const [showGitignored, setShowGitignored] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'editor'>('files');
  const [openedName, setOpenedName] = useState<string | null>(null);

  // `/fs/tree` only resolves by session today, so the session binding lives here. `useFileTree`
  // resets on this function's identity, so it must change exactly when the session does: keying
  // it on anything else (cwd included) would drop the loaded tree while `expandedPaths` survives.
  const loadDir = useCallback(
    (path: string) =>
      sessionId === null ? Promise.reject(new Error('no session')) : getFileTree(sessionId, path),
    [sessionId],
  );
  const { childrenByPath, loadPath } = useFileTree(session?.cwd ?? null, lastActivity, loadDir);

  useEffect(() => {
    setActiveTab('files');
    setOpenedName(null);
  }, [sessionId]);

  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const rows =
    sessionId === null
      ? []
      : visibleTreeRows(childrenByPath[''], childrenByPath, expandedSet, showGitignored);

  function toggleDir(path: string) {
    if (sessionId === null) return;
    const willExpand = !expandedSet.has(path);
    toggleExpandedPath(sessionId, path);
    if (willExpand && childrenByPath[path] === undefined) loadPath(path);
  }

  function openFile(path: string) {
    if (sessionId !== null) requestOpenFile(sessionId, path, null);
  }

  // Memoized so Viewer's effect that calls this on a fresh fetch can depend on it without an
  // inline arrow here forcing that effect to re-run — and refetch — on every render.
  const onFileOpened = useCallback((path: string) => {
    setOpenedName(path);
    setActiveTab('editor');
  }, []);

  if (sessionId === null || session === undefined) {
    return (
      <>
        <div className="fp-header">
          <div className="fp-session muted">No session focused</div>
        </div>
        <div className="fp-none">Focus a pane on stage to browse its files.</div>
      </>
    );
  }

  return (
    <>
      <div className="fp-header">
        <div className="fp-session">{session.title ?? session.cwd}</div>
        <div className="fp-cwd">{session.cwd}</div>
      </div>
      <div className="fp-tabs">
        <button
          className={`fp-tab${activeTab === 'files' ? ' active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          Files
        </button>
        <button
          className={`fp-tab${activeTab === 'editor' ? ' active' : ''}`}
          title={openedName ?? undefined}
          onClick={() => setActiveTab('editor')}
        >
          {openedName ?? 'Editor'}
        </button>
      </div>
      <div className="fp-tab-content" hidden={activeTab !== 'files'}>
        <div className="fp-tree-toolbar">
          <span className="upper faint">Files</span>
          <button
            className={`toggle-pill${showGitignored ? ' on' : ''}`}
            onClick={() => setShowGitignored((value) => !value)}
          >
            <span className="dot" />
            <span>Show gitignored</span>
          </button>
        </div>
        <div className="fp-tree">
          {rows.map((row) => (
            <TreeRow
              key={row.entry.path}
              row={row}
              selected={
                openFileRequest?.sessionId === sessionId && openFileRequest.path === row.entry.path
              }
              onToggleDir={toggleDir}
              onOpenFile={openFile}
            />
          ))}
        </div>
      </div>
      <div className="fp-tab-content" hidden={activeTab !== 'editor'}>
        <Viewer sessionId={sessionId} onFileOpened={onFileOpened} />
      </div>
    </>
  );
}
