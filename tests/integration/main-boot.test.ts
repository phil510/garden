import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionState, SessionsResponse } from '@garden/shared'
import { describe, expect, it } from 'vitest'
import { until } from './support/poll.js'
import { withTmuxServer } from './support/tmux-server.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const loader = join(root, 'node_modules/tsx/dist/loader.mjs')

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('missing address')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  return port
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    await exited
  } finally {
    clearTimeout(force)
  }
}

async function start(env: NodeJS.ProcessEnv, url: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', loader, join(root, 'packages/server/bin/garden.ts')],
    {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  let stderr = ''
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString()
  })
  try {
    await until(
      'main.ts to listen',
      async () => {
        if (child.exitCode !== null) throw new Error(stderr)
        try {
          return (await fetch(`${url}/health`).then((r) => r.json())) as { pid?: number }
        } catch {
          return {}
        }
      },
      (body) => body.pid === child.pid,
      30_000,
    )
    return child
  } catch (error) {
    await stop(child)
    throw error
  }
}

async function sessions(url: string): Promise<SessionState[]> {
  const response = await fetch(`${url}/sessions?sinceDays=0`)
  const body = (await response.json()) as SessionsResponse
  return body.sessions
}

describe('main.ts boot wiring', () => {
  it('restores registration and transcript fields after the server restarts', async () => {
    await withTmuxServer(async ({ socket }) => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'garden-main-')))
      const appDir = join(dir, 'app')
      const transcriptsDir = join(dir, 'transcripts')
      const cwd = join(dir, 'project')
      mkdirSync(appDir)
      mkdirSync(cwd)
      writeFileSync(join(appDir, 'config.json'), JSON.stringify({ roots: [cwd] }))
      const port = await freePort()
      const url = `http://127.0.0.1:${port}`
      const env = {
        ...process.env,
        GARDEN_SERVER_PROCESS: '1',
        GARDEN_HARNESS: 'claude',
        GARDEN_PORT: String(port),
        GARDEN_APP_DIR: appDir,
        GARDEN_TMUX_SOCKET: socket,
        GARDEN_TRANSCRIPTS_DIR: transcriptsDir,
        GARDEN_CLAUDE_SESSIONS_DIR: join(dir, 'names'),
        GARDEN_CLAUDE_COMMAND: `${process.execPath} --import ${loader} ${join(root, 'scripts/fake-claude.ts')}`,
      }
      let child: ChildProcess | undefined
      try {
        child = await start(env, url)
        const response = await fetch(`${url}/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cwd }),
        })
        expect(response.status).toBe(200)
        const { id } = (await response.json()) as { id: string }
        const before = await until(
          'transcript facts before restart',
          () => sessions(url),
          (rows) => rows.some((s) => s.id === id && s.title !== null && s.recap !== null),
        )
        const original = before.find((s) => s.id === id)!
        await stop(child)
        child = await start(env, url)
        const restored = (await sessions(url)).find((s) => s.id === id)
        expect(restored).toMatchObject({
          id,
          cwd,
          tmuxName: original.tmuxName,
          title: original.title,
          recap: original.recap,
          lastActivity: original.lastActivity,
        })
        expect(restored?.tmuxName).not.toBeNull()
      } finally {
        if (child) await stop(child)
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
