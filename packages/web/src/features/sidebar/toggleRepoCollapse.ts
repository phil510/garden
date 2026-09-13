export function toggleRepoCollapse(collapsedRepos: string[], repoRoot: string): string[] {
  return collapsedRepos.includes(repoRoot)
    ? collapsedRepos.filter((root) => root !== repoRoot)
    : [...collapsedRepos, repoRoot];
}
