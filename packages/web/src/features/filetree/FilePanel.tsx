import type { TreeEntry } from '@garden/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFileTree } from '../../api/client';
import { useLocalStore } from '../../state/localStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { TreeRow } from './TreeRow';
import { visibleTreeRows } from './treeRows';
import { Viewer } from './Viewer';
import './filetree.css';

/** Long enough to collapse a burst of hook events into one refetch, short enough that a
 *  file edited mid-turn shows up without the user having to do anything. It is the interval
 *  between refreshes, not a quiet period: activity during a turn never stops arriving, so a
 *  window that reset on each event would leave the tree stale for the whole turn. */
const REFRESH_INTERVAL_MS = 500;

const EMPTY_EXPANDED: readonly string[] = [];

/** Loaded directories, tagged with the session they were fetched for. A tree load is in flight
 *  across a focus change often enough to matter, and the tag is what lets its response be
 *  dropped instead of landing in the newly focused session's tree. */
interface TreeState {
  readonly sessionId: string | null;
  readonly childrenByPath: Record<string, readonly TreeEntry[]>;
}

/** Toggleable right panel bound to the focused pane's session, rooted at that session's
 *  cwd. Directories are fetched lazily into `tree` as they are expanded; there is no `/fs`
 *  filesystem watch, so a throttled effect on the focused session's own activity stands in for
 *  one, refetching every path already loaded. */
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

  const [tree, setTree] = useState<TreeState>({ sessionId: null, childrenByPath: {} });
  const [showGitignored, setShowGitignored] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'editor'>('files');
  const [openedName, setOpenedName] = useState<string | null>(null);

  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loadedPaths = useRef<readonly string[]>([]);

  const loadPath = useCallback((id: string, path: string) => {
    getFileTree(id, path)
      .then((response) => {
        setTree((current) =>
          current.sessionId === id
            ? {
                sessionId: id,
                childrenByPath: { ...current.childrenByPath, [path]: response.entries },
              }
            : current,
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setTree({ sessionId, childrenByPath: {} });
    setActiveTab('files');
    setOpenedName(null);
    if (sessionId !== null) loadPath(sessionId, '');
    return () => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
    };
  }, [sessionId, loadPath]);

  // The refresh reads the loaded paths through a ref so that its own writes to `tree` are not a
  // dependency of the effect below — they would otherwise retrigger it and turn the refresh into
  // an unconditional poll.
  useEffect(() => {
    loadedPaths.current = Object.keys(tree.childrenByPath);
  }, [tree]);

  // Throttled, not debounced: the first activity since the last refresh schedules the next one,
  // and everything arriving before it fires is absorbed into it.
  useEffect(() => {
    if (sessionId === null || lastActivity === null) return;
    if (refreshTimer.current !== undefined) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      for (const path of loadedPaths.current) loadPath(sessionId, path);
    }, REFRESH_INTERVAL_MS);
  }, [sessionId, lastActivity, loadPath]);

  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const rows =
    sessionId === null
      ? []
      : visibleTreeRows(tree.childrenByPath[''], tree.childrenByPath, expandedSet, showGitignored);

  function toggleDir(path: string) {
    if (sessionId === null) return;
    const willExpand = !expandedSet.has(path);
    toggleExpandedPath(sessionId, path);
    if (willExpand && tree.childrenByPath[path] === undefined) loadPath(sessionId, path);
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
