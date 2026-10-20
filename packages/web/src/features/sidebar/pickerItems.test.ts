import type { RepoEntry } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { buildPickerGroups } from './pickerItems';

const repo = (over: Partial<RepoEntry> = {}): RepoEntry => ({
  path: '/roots/garden',
  name: 'garden',
  branch: 'main',
  isWorktree: false,
  ...over,
});

const worktree = (over: Partial<RepoEntry> = {}): RepoEntry => ({
  path: '/roots/garden/.worktrees/feat-x',
  name: 'feat-x',
  branch: 'feat-x',
  isWorktree: true,
  ...over,
});

describe('buildPickerGroups', () => {
  it('groups a worktree under its own repo', () => {
    const groups = buildPickerGroups([repo(), worktree()], '');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.repoName).toBe('garden');
    expect(groups[0]?.items.map((item) => item.path)).toEqual([
      '/roots/garden',
      '/roots/garden/.worktrees/feat-x',
    ]);
  });

  it('groups a worktree checked out beside a bare clone under its repo', () => {
    const beside = worktree({ path: '/roots/garden/feat/x', name: 'x', branch: 'feat/x' });
    const groups = buildPickerGroups([repo(), beside], '');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.path)).toEqual([
      '/roots/garden',
      '/roots/garden/feat/x',
    ]);
  });

  it('labels a repo entry by its name and a worktree entry by its branch', () => {
    const groups = buildPickerGroups([repo(), worktree()], '');
    expect(groups[0]?.items[0]).toMatchObject({ label: 'garden', isWorktree: false });
    expect(groups[0]?.items[1]).toMatchObject({ label: 'feat-x', isWorktree: true });
  });

  it('drops a group with no matching entries rather than showing it empty', () => {
    const other = repo({ path: '/roots/other', name: 'other' });
    const groups = buildPickerGroups([repo(), other], 'other');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.repoName).toBe('other');
  });

  it('keeps a worktree grouped under its repo when only the worktree matches the query', () => {
    const groups = buildPickerGroups([repo(), worktree()], 'feat-x');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.repoName).toBe('garden');
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.label).toBe('feat-x');
  });

  it('matches the query against the path', () => {
    const groups = buildPickerGroups([repo(), worktree()], '.worktrees');
    expect(groups[0]?.items).toHaveLength(1);
  });

  it('returns nothing when no entry matches', () => {
    expect(buildPickerGroups([repo(), worktree()], 'nope')).toEqual([]);
  });

  it('does not fold a worktree of one repo under a different repo sharing a path prefix', () => {
    const decoy = repo({ path: '/roots/garden-decoy', name: 'garden-decoy' });
    const groups = buildPickerGroups([repo(), decoy, worktree()], '');
    const decoyGroup = groups.find((group) => group.repoName === 'garden-decoy');
    expect(decoyGroup?.items).toHaveLength(1);
    expect(decoyGroup?.items[0]?.isWorktree).toBe(false);
  });

  it('preserves input order across repos', () => {
    const b = repo({ path: '/roots/b', name: 'b' });
    const groups = buildPickerGroups([b, repo()], '');
    expect(groups.map((group) => group.repoName)).toEqual(['b', 'garden']);
  });
});
