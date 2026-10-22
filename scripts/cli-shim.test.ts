import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstOnPath, installShim, renderShim, SHIM_MARKER } from './cli-shim.js';

let dir: string;
let root: string;
let binDir: string;
let target: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'garden-cli-shim-'));
  root = join(dir, 'checkout');
  binDir = join(dir, 'bin');
  target = join(root, 'packages', 'server', 'dist', 'garden.js');
  mkdirSync(join(root, 'packages', 'server', 'dist'), { recursive: true });
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'packages', 'server', 'dist', 'package.json'), '{"type":"module"}');
  writeBuild('process.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(3);\n');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeBuild(source: string): void {
  writeFileSync(target, source);
}

function install(overrides: { pathEnv?: string; force?: boolean } = {}) {
  return installShim({
    root,
    binDir,
    pathEnv: overrides.pathEnv ?? binDir,
    force: overrides.force ?? false,
  });
}

function runShim(shimPath: string, args: string[] = []) {
  return spawnSync(shimPath, args, { encoding: 'utf8' });
}

describe('the rendered shim', () => {
  // The launcher has no extension, so what loads it depends on the nearest package.json —
  // which is whatever happens to sit above the user's bin directory.
  it.each([
    ['no package.json', null],
    ['a "type": "module" package.json', '{"type":"module"}'],
    ['a "type": "commonjs" package.json', '{"type":"commonjs"}'],
  ])('runs the build with its arguments and exit code under %s', (_label, packageJson) => {
    mkdirSync(binDir);
    if (packageJson !== null) writeFileSync(join(binDir, 'package.json'), packageJson);
    const shimPath = join(binDir, 'garden');
    writeFileSync(shimPath, renderShim(target));
    chmodSync(shimPath, 0o755);

    const result = runShim(shimPath, ['ls', '--json']);

    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('["ls","--json"]');
    expect(result.status).toBe(3);
  });

  it('names the missing build and how to fix it instead of a module-resolution stack', () => {
    const { shimPath } = install();
    rmSync(target);

    const result = runShim(shimPath);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      `garden: no build at ${target}\n` +
        'garden: run `pnpm install && pnpm cli:install` from your garden checkout\n',
    );
  });

  it('turns a dependency the build cannot resolve into the same hint', () => {
    const { shimPath } = install();
    writeBuild("import 'garden-no-such-package';\n");

    const result = runShim(shimPath);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^garden: Cannot find package 'garden-no-such-package'/);
    expect(result.stderr).toMatch(/\ngarden: run `pnpm install && pnpm cli:install`/);
  });
});

describe('installShim', () => {
  it('writes an executable launcher pointing at the checkout build', () => {
    const result = install();

    expect(result.shimPath).toBe(join(binDir, 'garden'));
    expect(result.target).toBe(target);
    expect(result.warnings).toEqual([]);
    expect(runShim(result.shimPath, ['x']).stdout).toBe('["x"]');
  });

  it('re-points an existing launcher when run from a moved checkout', () => {
    install();
    const moved = join(dir, 'moved');
    mkdirSync(join(moved, 'packages', 'server', 'dist'), { recursive: true });
    mkdirSync(join(moved, '.git'));
    writeFileSync(
      join(moved, 'packages', 'server', 'dist', 'garden.js'),
      "process.stdout.write('moved');\n",
    );

    const result = installShim({ root: moved, binDir, pathEnv: binDir, force: false });

    expect(runShim(result.shimPath).stdout).toBe('moved');
  });

  it('refuses when the checkout has no build', () => {
    rmSync(target);

    expect(() => install()).toThrow(`no build at ${target}`);
  });

  it('refuses to replace a garden it did not write, unless forced', () => {
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'garden'), '#!/bin/sh\necho someone else\n');

    expect(() => install()).toThrow(/was not written by this installer/);
    expect(readFileSync(join(binDir, 'garden'), 'utf8')).toContain('someone else');

    install({ force: true });
    expect(readFileSync(join(binDir, 'garden'), 'utf8')).toContain(SHIM_MARKER);
  });

  it('treats a symlink as foreign and replaces the link, not what it points at', () => {
    mkdirSync(binDir);
    const elsewhere = join(dir, 'elsewhere.js');
    writeFileSync(elsewhere, `// ${SHIM_MARKER}\n`);
    symlinkSync(elsewhere, join(binDir, 'garden'));

    expect(() => install()).toThrow(/was not written by this installer/);

    install({ force: true });
    expect(readFileSync(elsewhere, 'utf8')).toBe(`// ${SHIM_MARKER}\n`);
  });

  it('warns when installing from a linked worktree', () => {
    rmSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');

    expect(install().warnings).toEqual([expect.stringMatching(/is a git worktree/)]);
  });

  it('warns when the bin directory is not on PATH', () => {
    expect(install({ pathEnv: join(dir, 'other') }).warnings).toEqual([
      `${binDir} is not on PATH — add it to your shell profile`,
    ]);
  });

  it('warns when another garden comes earlier on PATH', () => {
    const earlier = join(dir, 'earlier');
    mkdirSync(earlier);
    writeFileSync(join(earlier, 'garden'), '#!/bin/sh\n', { mode: 0o755 });

    expect(install({ pathEnv: [earlier, binDir].join(delimiter) }).warnings).toEqual([
      expect.stringMatching(new RegExp(`^${join(earlier, 'garden')} comes first on PATH`)),
    ]);
  });
});

describe('firstOnPath', () => {
  it('skips non-executable matches and empty entries', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, 'tool'), '', { mode: 0o644 });
    writeFileSync(join(b, 'tool'), '', { mode: 0o755 });

    expect(firstOnPath('tool', ['', a, b].join(delimiter))).toBe(join(b, 'tool'));
    expect(firstOnPath('tool', a)).toBeNull();
  });
});
