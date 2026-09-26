export function toggleSwarmCollapse(collapsedSwarms: string[], swarmId: string): string[] {
  return collapsedSwarms.includes(swarmId)
    ? collapsedSwarms.filter((id) => id !== swarmId)
    : [...collapsedSwarms, swarmId];
}
