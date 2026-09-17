export function toggleHideDeadRepo(hideDeadRepos: string[], repoRoot: string): string[] {
  return hideDeadRepos.includes(repoRoot)
    ? hideDeadRepos.filter((root) => root !== repoRoot)
    : [...hideDeadRepos, repoRoot];
}
