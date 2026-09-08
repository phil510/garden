// Prepares the sandbox's on-disk fixtures before `dev:sandbox` starts the server: a real git
// repo for fake sessions to run against, and a config.json whose `roots` names the fixture
// repo's PARENT directory — `listRepos` walks a root's subdirectories looking for repos, so
// the root itself must not be the repo, or the new-session picker never finds it. Idempotent
// and safe to run on every `dev:sandbox` start — it only creates what's missing.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

mkdirSync(fixtureRepo, { recursive: true });
if (!existsSync(join(fixtureRepo, '.git'))) {
  execFileSync('git', ['init'], { cwd: fixtureRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'Sandbox fixture repo'], {
    cwd: fixtureRepo,
    env: gitEnv,
    stdio: 'ignore',
  });
}

if (!existsSync(configPath)) {
  const port = Number(process.env.GARDEN_PORT ?? 4310);
  const config = { port, roots: [appDir] };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
