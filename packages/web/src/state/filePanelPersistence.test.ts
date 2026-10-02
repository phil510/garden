import type { RepoEntry } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import {
  chooseStartupRoot,
  defaultFilePanel,
  parseFilePanel,
  type PersistedFilePanel,
} from './filePanelPersistence';

const entry = (path: string): RepoEntry => ({ path, name: path, branch: null, isWorktree: false });

describe('parseFilePanel', () => {
  it('returns defaults when nothing is stored', () => {
    expect(parseFilePanel(null)).toEqual(defaultFilePanel());
  });

  it('defaults to showing gitignored files with no root', () => {
    expect(defaultFilePanel()).toEqual({ root: null, showGitignored: true, byRoot: {} });
  });

  it('discards an unreadable value', () => {
    expect(parseFilePanel('{not json')).toEqual(defaultFilePanel());
  });

  it('discards a value that is not an object', () => {
    expect(parseFilePanel('[1,2]')).toEqual(defaultFilePanel());
    expect(parseFilePanel('null')).toEqual(defaultFilePanel());
  });

  it('discards an older-shape value whole', () => {
    expect(parseFilePanel(JSON.stringify({ root: '/a', expanded: ['src'] }))).toEqual(
      defaultFilePanel(),
    );
  });

  it('discards the whole value when one root entry has a bad tab', () => {
    const raw = JSON.stringify({
      root: '/a',
      showGitignored: false,
      byRoot: { '/a': { expanded: [], openFile: null, tab: 'sideways' } },
    });
    expect(parseFilePanel(raw)).toEqual(defaultFilePanel());
  });

  it('discards the whole value when expanded holds a non-string', () => {
    const raw = JSON.stringify({
      root: null,
      showGitignored: true,
      byRoot: { '/a': { expanded: [1], openFile: null, tab: 'files' } },
    });
    expect(parseFilePanel(raw)).toEqual(defaultFilePanel());
  });

  it('round-trips a valid value', () => {
    const value: PersistedFilePanel = {
      root: '/a',
      showGitignored: false,
      byRoot: { '/a': { expanded: ['src', 'src/lib'], openFile: 'src/x.ts', tab: 'editor' } },
    };
    expect(parseFilePanel(JSON.stringify(value))).toEqual(value);
  });
});

describe('chooseStartupRoot', () => {
  const repos = [entry('/work/app'), entry('/work/app/.worktrees/feat'), entry('/work/lib')];

  it('keeps the persisted root when it is listed', () => {
    expect(chooseStartupRoot('/work/lib', repos, '/work/app')).toBe('/work/lib');
  });

  it('falls back to the focused session jump target when the persisted root is unlisted', () => {
    expect(chooseStartupRoot('/gone', repos, '/work/app/.worktrees/feat/src')).toBe(
      '/work/app/.worktrees/feat',
    );
  });

  it('uses the jump target when nothing is persisted', () => {
    expect(chooseStartupRoot(null, repos, '/work/lib/x')).toBe('/work/lib');
  });

  it('falls back to the first entry when there is no jump target', () => {
    expect(chooseStartupRoot('/gone', repos, '/elsewhere')).toBe('/work/app');
    expect(chooseStartupRoot(null, repos, null)).toBe('/work/app');
  });

  it('returns null when no repos are listed', () => {
    expect(chooseStartupRoot('/gone', [], '/work/app')).toBeNull();
  });
});
