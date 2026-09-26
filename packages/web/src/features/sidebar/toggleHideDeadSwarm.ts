export function toggleHideDeadSwarm(hideDeadSwarms: string[], swarmId: string): string[] {
  return hideDeadSwarms.includes(swarmId)
    ? hideDeadSwarms.filter((id) => id !== swarmId)
    : [...hideDeadSwarms, swarmId];
}
