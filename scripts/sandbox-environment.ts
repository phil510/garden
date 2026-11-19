import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Sandbox isolation must not inherit the live instance's settings from a Garden pane. */
export function sandboxEnvironment(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (args.length > 1 || (args.length === 1 && !['--claude', '--codex'].includes(args[0]!))) {
    throw new Error('Usage: pnpm dev:sandbox:server [--claude | --codex]')
  }
  const harness = args[0] === '--codex' ? 'codex' : 'claude'
  const appDir = env.GARDEN_SANDBOX_APP_DIR || join(homedir(), '.garden-sandbox')
  const command = `${process.execPath} --import ${join(root, 'node_modules/tsx/dist/loader.mjs')} ${join(root, `scripts/fake-${harness}.ts`)}`
  return {
    ...env,
    GARDEN_SERVER_PROCESS: '1',
    GARDEN_HARNESS: harness,
    GARDEN_PORT: env.GARDEN_SANDBOX_PORT || '4312',
    GARDEN_TMUX_SOCKET: env.GARDEN_SANDBOX_SOCKET || 'garden-sandbox',
    GARDEN_APP_DIR: appDir,
    GARDEN_TRANSCRIPTS_DIR: join(appDir, 'transcripts'),
    CODEX_HOME: join(appDir, 'codex-home'),
    GARDEN_CLAUDE_COMMAND: harness === 'claude' ? command : undefined,
    GARDEN_CODEX_COMMAND: harness === 'codex' ? command : undefined,
  }
}
