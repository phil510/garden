import { describe, expect, it } from 'vitest';
import { countsAsChange } from './fsWatch.js';

describe('countsAsChange', () => {
  it.each(['src/a.ts', 'a.txt', '.gitignore', '.github/workflows/ci.yml', 'src/a.git', null])(
    'counts %s',
    (filename) => expect(countsAsChange(filename)).toBe(true),
  );

  it.each(['.git/index', '.git/HEAD'])("counts the root repo's %s", (filename) =>
    expect(countsAsChange(filename)).toBe(true),
  );

  it.each([
    '.git',
    '.git/index.lock',
    '.git/refs/heads/main',
    '.git/objects/ab/cd',
    'sub/.git/index',
    'sub/.git/HEAD',
  ])('ignores %s', (filename) => expect(countsAsChange(filename)).toBe(false));
});
