/** Names the action the toggle performs, not the view it's currently in: hiding while dead
 *  sessions show, showing while they're hidden. */
export function hideDeadLabel(hideDead: boolean): string {
  return hideDead ? 'Show dead' : 'Hide dead';
}
