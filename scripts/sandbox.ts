import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxEnvironment } from './sandbox-environment.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let env: NodeJS.ProcessEnv;
try {
  env = sandboxEnvironment(process.argv.slice(2), process.env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const loader = join(root, 'node_modules/tsx/dist/loader.mjs');
const setup = spawnSync(
  process.execPath,
  ['--import', loader, join(root, 'scripts/setup-sandbox.ts')],
  { env, stdio: 'inherit', timeout: 30_000 },
);
if (setup.error) console.error(setup.error.message);
if (setup.status !== 0) process.exit(setup.status ?? 1);

const server = spawn(
  process.execPath,
  ['--import', loader, join(root, 'packages/server/bin/garden.ts')],
  { env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
});
