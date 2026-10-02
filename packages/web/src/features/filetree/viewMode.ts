export type ViewMode = 'rendered' | 'source';

/**
 * Decides which mode a newly-opened file should reset to. A markdown file opened with a real
 * line target came from a `path:line` link rather than a plain tree click (which requests no
 * line) — only that case needs source mode, since the scroll-to-line effect targets the token
 * view's one-DOM-child-per-line structure, which rendered prose doesn't have. Every other file
 * opens rendered.
 */
export function resetModeForOpenedFile(
  showMarkdown: boolean,
  pendingLine: number | null,
): ViewMode {
  return showMarkdown && pendingLine !== null ? 'source' : 'rendered';
}

/**
 * Whether a new `file` object should reset the view mode. A refetch of the same source brings a
 * new object when its content changed, and must not undo the user's choice; a different source,
 * or a pending line request that picks its own mode, does reset it.
 */
export function shouldResetMode(
  previousKey: string | null,
  nextKey: string | null,
  pendingLine: number | null,
): boolean {
  return previousKey !== nextKey || pendingLine !== null;
}
