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
