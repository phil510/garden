import { useState } from 'react';
import { ContextMenu } from '../../components/ContextMenu';
import { entryPaths } from './entryPaths';
import { gitStatusBadge } from './gitStatusBadge';
import type { FlatTreeRow } from './treeRows';
import { useCopyFlash } from './useCopyFlash';

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
  root: string;
  selected: boolean;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
}

export function TreeRow({ row, root, selected, onToggleDir, onOpenFile }: TreeRowProps) {
  const { entry, depth, expanded, ignored } = row;
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const { copied, copy } = useCopyFlash();
  const badge = gitStatusBadge(entry.gitStatus);
  const classNames = ['tree-node-row', selected && 'selected', ignored && 'gitignored']
    .filter(Boolean)
    .join(' ');

  const paths = entryPaths(root, entry.path);
  const copyAndClose = (text: string) => {
    copy(text);
    setMenuAt(null);
  };

  return (
    <>
      <div
        className={classNames}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (entry.kind === 'dir' ? onToggleDir(entry.path) : onOpenFile(entry.path))}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
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
        {copied && <span className="tcopied">Copied</span>}
      </div>
      {menuAt !== null && (
        // A sibling of the row, not a child, so the menu's events never reach the row's onClick.
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          items={[
            {
              key: 'copy-absolute',
              label: 'Copy absolute path',
              onSelect: () => copyAndClose(paths.absolute),
            },
            {
              key: 'copy-relative',
              label: 'Copy relative path',
              onSelect: () => copyAndClose(paths.relative),
            },
          ]}
          onClose={() => setMenuAt(null)}
        />
      )}
    </>
  );
}
