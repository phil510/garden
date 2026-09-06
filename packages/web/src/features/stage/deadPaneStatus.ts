/** The dead placeholder's first line. Whether tmux still holds the pane changes only this
 *  line — the icon, the recap and the Resume button stay the same either way. */
export function deadPaneStatusLine(exitCode: number | null): string {
  return typeof exitCode === 'number'
    ? `Not running — exited with code ${exitCode}`
    : 'Not running';
}
