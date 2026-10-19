interface ShowMoreDeadRowProps {
  hiddenCount: number;
  expanded: boolean;
  onToggle: () => void;
}

export function ShowMoreDeadRow({ hiddenCount, expanded, onToggle }: ShowMoreDeadRowProps) {
  if (hiddenCount === 0) return null;
  return (
    <div className="show-older-row" onClick={onToggle}>
      {expanded ? 'Show less' : `Show ${hiddenCount} more…`}
    </div>
  );
}
