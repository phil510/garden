// Puts `garden` on PATH as a launcher for this checkout's build. `pnpm cli:install` builds first
// and then runs this; running it again re-points the launcher after the checkout moves.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { installShim } from './cli-shim.js';

try {
  // pnpm hands a `--` separator through to the script, and npm habit puts one there.
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      'bin-dir': { type: 'string', default: join(homedir(), '.local', 'bin') },
      force: { type: 'boolean', default: false },
    },
  });
  const result = installShim({
    root: resolve(import.meta.dirname, '..'),
    binDir: values['bin-dir'],
    pathEnv: process.env.PATH ?? '',
    force: values.force,
  });
  console.log(`Installed ${result.shimPath} -> ${result.target}`);
  for (const warning of result.warnings) console.error(`warning: ${warning}`);
} catch (error) {
  console.error(`cli:install: ${(error as Error).message}`);
  process.exit(1);
}
