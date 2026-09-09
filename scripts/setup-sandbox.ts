// Prepares the sandbox before `dev:sandbox` starts the server: a fresh tmux server on the
// sandbox socket, a real git repo for fake sessions to run against, and a config.json whose
// `roots` names the fixture repo's PARENT directory — `listRepos` walks a root's subdirectories
// looking for repos, so the root itself must not be the repo, or the new-session picker never
// finds it. Idempotent and safe to run on every `dev:sandbox` start.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, TMUX_SOCKET } from '../packages/server/src/config.js';
import { socketHasLivePanes } from '../packages/server/src/adapters/tmux.js';

const appDir = process.env.GARDEN_APP_DIR ?? join(homedir(), '.garden-sandbox');
const fixtureRepo = join(appDir, 'fixture-repo');
const configPath = join(appDir, 'config.json');
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'garden-sandbox',
  GIT_AUTHOR_EMAIL: 'sandbox@localhost',
  GIT_COMMITTER_NAME: 'garden-sandbox',
  GIT_COMMITTER_EMAIL: 'sandbox@localhost',
};

// A tmux server outlives this process and keeps whatever environment it captured at its own
// first launch. Without this, a server left running from an earlier sandbox start would hand
// new panes a stale GARDEN_TRANSCRIPTS_DIR even after the sandbox app dir changes underneath it.
const sandboxSocket = loadConfig(process.env).tmuxSocket;
try {
  assertNotProductionSocket(sandboxSocket);
  // A probe failure (tmux missing, an unrecognized stderr shape) also lands here and exits
  // 1 with the raw tmux error rather than the refusal message below — that's the correct
  // fail-closed choice, not an accidental swallow.
  if (await socketHasLivePanes(sandboxSocket)) {
    throw new Error(
      `tmux socket "${sandboxSocket}" is already held by a live server — refusing to kill ` +
        'it. Give this sandbox its own namespace with GARDEN_SANDBOX_PORT, ' +
        'GARDEN_SANDBOX_VITE_PORT, GARDEN_SANDBOX_SOCKET and GARDEN_SANDBOX_APP_DIR.',
    );
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
killTmuxServer(sandboxSocket);

mkdirSync(fixtureRepo, { recursive: true });
if (!existsSync(join(fixtureRepo, '.git'))) {
  execFileSync('git', ['init'], { cwd: fixtureRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'Sandbox fixture repo'], {
    cwd: fixtureRepo,
    env: gitEnv,
    stdio: 'ignore',
  });
}

// Rewritten whenever `roots` has drifted, not just when the file is absent: a sandbox booted
// before this script existed has a config the server wrote with the default roots, which leaves
// the fixture repo out of the picker and the sandbox transcripts out of scope — both silently.
const port = Number(process.env.GARDEN_PORT ?? 4310);
if (!existsSync(configPath) || !rootsInclude(configPath, appDir)) {
  writeFileSync(configPath, `${JSON.stringify({ port, roots: [appDir] }, null, 2)}\n`, 'utf8');
}

function rootsInclude(path: string, root: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const roots = (parsed as { roots?: unknown }).roots;
    return Array.isArray(roots) && roots.includes(root);
  } catch {
    return false;
  }
}

/** Refuses to kill the socket garden's real tmux server runs on, so a bug in sandbox socket
 *  resolution fails loudly here instead of disturbing the developer's own sessions. */
function assertNotProductionSocket(socket: string): void {
  if (socket === TMUX_SOCKET) {
    throw new Error(
      `sandbox tmux socket resolved to "${socket}", which is garden's production socket — refusing to kill it`,
    );
  }
}

/** kill-server exits non-zero when no server is running on this socket, which is the normal
 *  case the first time a sandbox starts. */
function killTmuxServer(socket: string): void {
  try {
    execFileSync('tmux', ['-L', socket, 'kill-server']);
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? '';
    if (!/no server running|error connecting to/i.test(stderr)) throw error;
  }
}
