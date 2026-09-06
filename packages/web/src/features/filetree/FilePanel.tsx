import type { TreeEntry } from '@garden/shared';
import { useEffect, useMemo, useState } from 'react';
import { getFileTree } from '../../api/client';
import { useLocalStore } from '../../state/localStore';
import { useSessionStore } from '../../state/sessionStore';
import { useUiStore } from '../../state/uiStore';
import { gitStatusBadge } from './gitStatusBadge';
import { visibleTreeRows, type FlatTreeRow } from './treeRows';
import './filetree.css';

/** Long enough to collapse a burst of hook events into one refetch, short enough that a
 *  file edited mid-turn shows up without the user having to do anything. */
const REFRESH_DEBOUNCE_MS = 500;

const EMPTY_EXPANDED: readonly string[] = [];

const FOLDER_ICON = (
  <svg className="ticon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);
const FILE_ICON = (
  <svg className="ticon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M6 3h8l4 4v14H6V3Z" />
    <path d="M14 3v4h4" />
  </svg>
);

interface TreeRowProps {
  row: FlatTreeRow;
  selected: boolean;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
}

function TreeRow({ row, selected, onToggleDir, onOpenFile }: TreeRowProps) {
  const { entry, depth, expanded } = row;
  const badge = gitStatusBadge(entry.gitStatus);
  const ignored = entry.gitStatus === '!!';
  const classNames = ['tree-node-row', selected && 'selected', ignored && 'gitignored']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classNames}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => (entry.kind === 'dir' ? onToggleDir(entry.path) : onOpenFile(entry.path))}
    >
      {entry.kind === 'dir' ? (
        <svg
          className="tchev"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          style={{ transform: `rotate(${expanded ? 90 : 0}deg)` }}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      ) : (
        <svg className="tchev leaf" viewBox="0 0 24 24" />
      )}
      {entry.kind === 'dir' ? FOLDER_ICON : FILE_ICON}
      <span className="tname">{entry.name}</span>
      {badge !== null && <span className={badge.className}>{badge.letter}</span>}
    </div>
  );
}

/** Toggleable right panel bound to the focused pane's session, rooted at that session's
 *  cwd. Directories are fetched lazily into `childrenByPath` as they are expanded; there
 *  is no `/fs` filesystem watch, so a debounced effect on the focused session's own data
 *  stands in for one, refetching every path already loaded. */
export function FilePanel() {
  const slots = useUiStore((state) => state.uiState.slots);
  const focusedSlot = useUiStore((state) => state.uiState.focusedSlot);
  const sessionId = slots[focusedSlot] ?? null;
  const session = useSessionStore((state) =>
    sessionId === null ? undefined : state.sessions[sessionId],
  );

  const expandedPaths = useLocalStore((state) =>
    sessionId === null ? EMPTY_EXPANDED : (state.expandedPaths[sessionId] ?? EMPTY_EXPANDED),
  );
  const toggleExpandedPath = useLocalStore((state) => state.toggleExpandedPath);
  const requestOpenFile = useLocalStore((state) => state.requestOpenFile);
  const openFileRequest = useLocalStore((state) => state.openFileRequest);

  const [childrenByPath, setChildrenByPath] = useState<Record<string, readonly TreeEntry[]>>({});
  const [showGitignored, setShowGitignored] = useState(false);

  function loadPath(id: string, path: string) {
    getFileTree(id, path)
      .then((response) => {
        setChildrenByPath((current) => ({ ...current, [path]: response.entries }));
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    setChildrenByPath({});
    if (sessionId !== null) loadPath(sessionId, '');
  }, [sessionId]);

  useEffect(() => {
    if (sessionId === null || session === undefined) return;
    const timer = setTimeout(() => {
      for (const path of Object.keys(childrenByPath)) loadPath(sessionId, path);
    }, REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [session]);

  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const rows =
    sessionId === null
      ? []
      : visibleTreeRows(childrenByPath[''], childrenByPath, expandedSet, showGitignored);

  function toggleDir(path: string) {
    if (sessionId === null) return;
    const willExpand = !expandedSet.has(path);
    toggleExpandedPath(sessionId, path);
    if (willExpand && childrenByPath[path] === undefined) loadPath(sessionId, path);
  }

  function openFile(path: string) {
    if (sessionId !== null) requestOpenFile(sessionId, path, 1);
  }

  if (session === undefined) {
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
    </>
  );
}
