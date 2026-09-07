import type { RepoEntry } from '@garden/shared';

export interface PickerItem {
  readonly path: string;
  readonly label: string;
  readonly isWorktree: boolean;
}

export interface PickerGroup {
  readonly repoName: string;
  readonly items: readonly PickerItem[];
}

/** A worktree's path is always `<repo path>/.worktrees/<branch segments>`; picking the longest
 *  such match handles a repo nested under another root without mistaking a shorter unrelated
 *  prefix for ownership. */
function ownerRepo(worktree: RepoEntry, repos: readonly RepoEntry[]): RepoEntry | undefined {
  return repos
    .filter((repo) => !repo.isWorktree && worktree.path.startsWith(`${repo.path}/.worktrees/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** Groups repos with their worktrees for the new-session picker, filtered by a query matched
 *  against the owning repo's name, the entry's branch, and its path — a worktree stays grouped
 *  under its own repo's label even when only the worktree itself matches the query. A group with
 *  no matching entries is dropped rather than shown empty. */
export function buildPickerGroups(repos: readonly RepoEntry[], query: string): PickerGroup[] {
  const q = query.trim().toLowerCase();
  const order: string[] = [];
  const groups = new Map<string, { repoName: string; items: PickerItem[] }>();
  for (const repo of repos) {
    if (repo.isWorktree) continue;
    order.push(repo.path);
    groups.set(repo.path, { repoName: repo.name, items: [] });
  }
  for (const repo of repos) {
    const owner = repo.isWorktree ? ownerRepo(repo, repos) : repo;
    if (owner === undefined) continue;
    const group = groups.get(owner.path);
    if (group === undefined) continue;
    const haystack = `${owner.name} ${repo.branch ?? ''} ${repo.path}`.toLowerCase();
    if (q !== '' && !haystack.includes(q)) continue;
    const label = repo.isWorktree ? (repo.branch ?? repo.name) : repo.name;
    group.items.push({ path: repo.path, label, isWorktree: repo.isWorktree });
  }
  return order.map((path) => groups.get(path)!).filter((group) => group.items.length > 0);
}
