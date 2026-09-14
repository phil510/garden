export type ViewMode = 'rendered' | 'source';

/**
 * Decides which mode a newly-opened file should reset to. A markdown file requested past
 * line 1 got there via a real `path:line` link rather than a plain tree click (which always
 * requests line 1, and scrolling to line 1 is a visual no-op regardless of view) — only that
 * case needs source mode, since the scroll-to-line effect targets the token view's
 * one-DOM-child-per-line structure, which rendered prose doesn't have. Every other file opens
 * rendered.
 */
export function resetModeForOpenedFile(
  showMarkdown: boolean,
  pendingLine: number | null,
): ViewMode {
  return showMarkdown && pendingLine !== null && pendingLine > 1 ? 'source' : 'rendered';
}
