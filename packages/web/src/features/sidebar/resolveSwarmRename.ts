/** What a swarm-rename input commits: the trimmed draft, or null when that's a no-op — empty
 *  (the user cleared the field) or unchanged from the swarm's current name. */
export function resolveSwarmRename(currentName: string, draftName: string): string | null {
  const trimmed = draftName.trim();
  if (trimmed.length === 0 || trimmed === currentName) return null;
  return trimmed;
}
