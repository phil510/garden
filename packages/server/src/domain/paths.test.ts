import { describe, expect, it } from 'vitest';
import { isWithinRoot } from './paths.js';

const root = '/Users/phil/Desktop/Extend/garden';

describe('isWithinRoot', () => {
  it('accepts the root itself', () => {
    expect(isWithinRoot(root, root)).toBe(true);
  });

  it('accepts a nested descendant', () => {
    expect(isWithinRoot(root, `${root}/packages/server/src/main.ts`)).toBe(true);
  });

  it('rejects a `..` sequence that climbs out of the root', () => {
    expect(isWithinRoot(root, `${root}/packages/../../secrets/id_rsa`)).toBe(false);
  });

  it('accepts a `..` sequence that stays inside the root', () => {
    expect(isWithinRoot(root, `${root}/packages/server/../web/src/App.tsx`)).toBe(true);
  });

  it('rejects a `..` chain long enough to walk off the filesystem root', () => {
    expect(isWithinRoot(root, `${root}/../../../../../../etc/passwd`)).toBe(false);
  });

  it('rejects an absolute path elsewhere on the filesystem', () => {
    expect(isWithinRoot(root, '/etc/passwd')).toBe(false);
  });

  it('rejects a sibling whose name merely extends the root as a string', () => {
    expect(isWithinRoot('/foo/bar', '/foo/barbaz/file.ts')).toBe(false);
  });

  it('accepts a symlink whose resolved target is inside the root', () => {
    const resolvedTarget = `${root}/packages/shared/src/index.ts`;
    expect(isWithinRoot(root, resolvedTarget)).toBe(true);
  });

  it('rejects a symlink whose resolved target is outside the root', () => {
    const resolvedTarget = '/Users/phil/.ssh/id_rsa';
    expect(isWithinRoot(root, resolvedTarget)).toBe(false);
  });

  it('rejects a relative candidate rather than anchoring it to the root', () => {
    expect(isWithinRoot(root, 'packages/server/src/main.ts')).toBe(false);
  });

  it('rejects a relative root', () => {
    expect(isWithinRoot('garden', 'garden/packages')).toBe(false);
  });

  it('ignores a trailing separator and doubled separators on either side', () => {
    expect(isWithinRoot(`${root}/`, `${root}//packages///server`)).toBe(true);
  });

  it('treats every absolute path as inside the filesystem root', () => {
    expect(isWithinRoot('/', '/etc/passwd')).toBe(true);
  });
});
