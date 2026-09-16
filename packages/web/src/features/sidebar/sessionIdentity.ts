/**
 * The session identity label shown in the sidebar and the pane header: `<name> (<id>)` when
 * the Claude-side name is known, the bare id otherwise — never a stale or guessed name.
 */
export function sessionIdentityLabel(name: string | null, id: string): string {
  return name === null ? id : `${name} (${id})`;
}
