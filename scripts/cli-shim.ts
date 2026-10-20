import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

/** Identifies a launcher this installer wrote, so a reinstall replaces it and nothing else. */
export const SHIM_MARKER = 'garden-cli-shim';

const REINSTALL_HINT = 'run `pnpm install && pnpm cli:install` from your garden checkout';

/**
 * The launcher put on PATH. It loads the build in place rather than being a copy of it: the
 * bundle keeps node-pty external, so it only runs beside the checkout's node_modules.
 *
 * The file has no extension, so Node may load it as CommonJS or as ESM depending on what
 * surrounds it; dynamic import() inside an async function is the one form valid in both.
 */
export function renderShim(target: string): string {
  return [
    '#!/usr/bin/env node',
    `// ${SHIM_MARKER}: written by \`pnpm cli:install\`. Run it again from the checkout to update.`,
    `const target = ${JSON.stringify(target)};`,
    `const hint = ${JSON.stringify(REINSTALL_HINT)};`,
    'const fail = (message) => {',
    '  process.stderr.write(`garden: ${message}\\ngarden: ${hint}\\n`);',
    '  process.exit(1);',
    '};',
    '(async () => {',
    "  const { existsSync } = await import('node:fs');",
    "  const { pathToFileURL } = await import('node:url');",
    '  if (!existsSync(target)) fail(`no build at ${target}`);',
    '  try {',
    '    await import(pathToFileURL(target).href);',
    '  } catch (error) {',
    "    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;",
    '    fail(error.message);',
    '  }',
    '})();',
    '',
  ].join('\n');
}

/** The first executable named `name` on a PATH-style string, or null. */
export function firstOnPath(name: string, pathEnv: string): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  }
  return null;
}

export interface InstallOptions {
  /** The checkout root; the shim points at its server build. */
  readonly root: string;
  readonly binDir: string;
  readonly pathEnv: string;
  readonly force: boolean;
}

export interface InstallResult {
  readonly shimPath: string;
  readonly target: string;
  readonly warnings: readonly string[];
}

export function installShim(options: InstallOptions): InstallResult {
  const root = resolve(options.root);
  const binDir = resolve(options.binDir);
  const target = join(root, 'packages', 'server', 'dist', 'garden.js');
  const shimPath = join(binDir, 'garden');

  try {
    accessSync(target);
  } catch {
    throw new Error(`no build at ${target} — run \`pnpm build\` first`);
  }

  if (!options.force && isForeign(shimPath)) {
    throw new Error(
      `${shimPath} exists and was not written by this installer — remove it, or pass --force to replace it`,
    );
  }

  mkdirSync(binDir, { recursive: true });
  // Written beside the destination and renamed over it, so a running `garden` never reads a
  // half-written launcher, and a symlink left there by `pnpm link` is replaced, not followed.
  const staging = `${shimPath}.${String(process.pid)}.tmp`;
  writeFileSync(staging, renderShim(target), { mode: 0o755 });
  renameSync(staging, shimPath);

  return { shimPath, target, warnings: installWarnings(root, binDir, shimPath, options.pathEnv) };
}

function isForeign(shimPath: string): boolean {
  let stat;
  try {
    stat = lstatSync(shimPath);
  } catch {
    return false;
  }
  return !stat.isFile() || !readFileSync(shimPath, 'utf8').includes(SHIM_MARKER);
}

function installWarnings(
  root: string,
  binDir: string,
  shimPath: string,
  pathEnv: string,
): string[] {
  const warnings: string[] = [];
  // A linked worktree's .git is a file. The launcher breaks when the worktree is removed,
  // which is how a hand-made `pnpm link` has failed before.
  if (lstatSync(join(root, '.git'), { throwIfNoEntry: false })?.isFile() === true) {
    warnings.push(
      `${root} is a git worktree — garden stops working if it is removed; install from the main checkout instead`,
    );
  }
  const pathDirs = pathEnv
    .split(delimiter)
    .filter((dir) => dir !== '')
    .map((dir) => resolve(dir));
  if (!pathDirs.includes(binDir)) {
    warnings.push(`${binDir} is not on PATH — add it to your shell profile`);
    return warnings;
  }
  const found = firstOnPath('garden', pathEnv);
  if (found !== null && resolve(found) !== shimPath) {
    warnings.push(
      `${found} comes first on PATH, so \`garden\` will not run this install — remove it (a \`pnpm link --global\` from before is removed with \`pnpm remove --global @garden/server\`)`,
    );
  }
  return warnings;
}
