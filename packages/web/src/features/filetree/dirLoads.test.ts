import type { TreeEntry } from '@garden/shared';
import { describe, expect, it } from 'vitest';
import { applyDirResult, emptyDirLoads, refreshPaths, type DirLoadState } from './dirLoads';

function entry(overrides: Partial<TreeEntry> & Pick<TreeEntry, 'name' | 'path'>): TreeEntry {
  return { kind: 'file', gitStatus: null, ...overrides };
}

const ok = (entries: TreeEntry[]) => ({ ok: true, entries }) as const;
const fail = (message: string) => ({ ok: false, message }) as const;

describe('applyDirResult', () => {
  const file = entry({ name: 'a.ts', path: 'src/a.ts' });

  it('drops a failure that arrives after a newer success', () => {
    const afterSuccess = applyDirResult(emptyDirLoads, 'src', 2, ok([file]));
    expect(applyDirResult(afterSuccess, 'src', 1, fail('boom'))).toBe(afterSuccess);
  });

  it('drops a success that arrives after a newer failure', () => {
    const afterFailure = applyDirResult(emptyDirLoads, 'src', 2, fail('boom'));
    expect(applyDirResult(afterFailure, 'src', 1, ok([file]))).toBe(afterFailure);
  });

  it('clears a prior error when a later fetch succeeds', () => {
    const failed = applyDirResult(emptyDirLoads, 'src', 1, fail('boom'));
    const next = applyDirResult(failed, 'src', 2, ok([file]));
    expect(next.errorByPath).toEqual({});
    expect(next.childrenByPath).toEqual({ src: [file] });
  });

  it('drops the stale children and records the error when a refetch fails after a success', () => {
    const loaded = applyDirResult(emptyDirLoads, 'src', 1, ok([file]));
    const next = applyDirResult(loaded, 'src', 2, fail('boom'));
    expect(next.childrenByPath).toEqual({});
    expect(next.errorByPath).toEqual({ src: 'boom' });
  });
});

describe('refreshPaths', () => {
  const src = entry({ name: 'src', path: 'src', kind: 'dir' });

  function state(overrides: Partial<DirLoadState>): DirLoadState {
    return { ...emptyDirLoads, ...overrides };
  }

  it('includes every loaded path', () => {
    expect(refreshPaths(state({ childrenByPath: { '': [src], src: [] } })).sort()).toEqual([
      '',
      'src',
    ]);
  });

  it('retries an errored folder its loaded parent still lists', () => {
    const s = state({ childrenByPath: { '': [src] }, errorByPath: { src: 'denied' } });
    expect(refreshPaths(s)).toContain('src');
  });

  it('retries an errored root', () => {
    expect(refreshPaths(state({ errorByPath: { '': 'down' } }))).toEqual(['']);
  });

  it('skips an errored path its parent no longer lists', () => {
    const s = state({ childrenByPath: { '': [] }, errorByPath: { gone: 'no such path' } });
    expect(refreshPaths(s)).not.toContain('gone');
  });
});
