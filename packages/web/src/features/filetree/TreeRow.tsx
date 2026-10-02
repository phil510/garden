import { gitStatusBadge } from './gitStatusBadge';
import type { FlatTreeRow } from './treeRows';

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

export function TreeRow({ row, selected, onToggleDir, onOpenFile }: TreeRowProps) {
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
