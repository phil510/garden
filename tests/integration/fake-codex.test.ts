import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { CreateSessionResponse, SessionState, SessionsResponse } from '@garden/shared'
import { describe, expect, it } from 'vitest'
import { until } from './support/poll.js'
import { withTmuxServer } from './support/tmux-server.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const loader = join(root, 'node_modules/tsx/dist/loader.mjs')
const exec = promisify(execFile)
async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing listen address')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    await exited
  } finally {
    clearTimeout(deadline)
  }
}
async function start(env: NodeJS.ProcessEnv, url: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['--import', loader, join(root, 'packages/server/bin/garden.ts')],
    { env, stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let errors = ''
  child.stderr.on('data', (data: Buffer) => {
    errors += data.toString()
  })
  try {
    await until(
      'isolated Codex main.ts server to listen',
      async () => {
        if (child.exitCode !== null) throw new Error(errors)
        try {
          return (await fetch(`${url}/health`).then((response) => response.json())) as {
            pid?: number
          }
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
async function rows(url: string): Promise<SessionState[]> {
  return (
    (await fetch(`${url}/sessions?sinceDays=36500`).then((response) =>
      response.json(),
    )) as SessionsResponse
  ).sessions
}
async function post(url: string, path: string, body: unknown) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path} (${response.status}): ${await response.text()}`)
  return response
}

function logTail(path: string): string {
  try {
    const fd = openSync(path, 'r')
    try {
      const size = fstatSync(fd).size
      const tail = Buffer.alloc(Math.min(size, 4096))
      const bytesRead = readSync(fd, tail, 0, tail.length, size - tail.length)
      return tail.toString('utf8', 0, bytesRead) || '(empty)'
    } finally {
      closeSync(fd)
    }
  } catch {
    return '(unavailable)'
  }
}

interface Alias {
  codexId: string | null
  transcriptPath: string | null
}

type NamedSession = CreateSessionResponse & { sessionName: string }
function aliases(appDir: string): Record<string, Alias> {
  return (
    JSON.parse(readFileSync(join(appDir, 'codex-aliases.json'), 'utf8')) as {
      sessions: Record<string, Alias>
    }
  ).sessions
}

describe('Codex through actual main.ts, tmux and generated hooks', () => {
  it('binds, tails, clears and restores both bound and pending sessions, including a binding while down', async () => {
    await withTmuxServer(async ({ socket }) => {
      const directory = realpathSync(mkdtempSync(join(tmpdir(), 'garden-fake-codex-')))
      const appDir = join(directory, 'app')
      const codexHome = join(directory, 'codex-home')
      const cwd = join(directory, 'project')
      mkdirSync(appDir)
      mkdirSync(codexHome)
      mkdirSync(cwd)
      writeFileSync(
        join(appDir, 'config.json'),
        JSON.stringify({ roots: [cwd], permissionMode: 'bypassPermissions' }),
      )
      const port = await freePort()
      const url = `http://127.0.0.1:${port}`
      const env = {
        ...process.env,
        GARDEN_SERVER_PROCESS: '1',
        GARDEN_HARNESS: 'codex',
        GARDEN_PORT: String(port),
        GARDEN_APP_DIR: appDir,
        GARDEN_TMUX_SOCKET: socket,
        CODEX_HOME: codexHome,
        GARDEN_CODEX_COMMAND: `${process.execPath} --import ${loader} ${join(root, 'scripts/fake-codex.ts')}`,
      }
      const tmux = async (args: readonly string[]) =>
        (await exec('tmux', ['-L', socket, ...args], { timeout: 5000 })).stdout
      const paneState = async (name: string) => {
        const format =
          '#{pane_id}\t#{pane_pid}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}'
        const [paneId, pid, dead, exitStatus, exitSignal] = (
          await tmux(['display-message', '-p', '-t', name, format])
        )
          .trimEnd()
          .split('\t')
        return { paneId, pid, dead: dead === '1', exitStatus, exitSignal }
      }
      const ready = (name: string) =>
        until(
          'fake Codex stdin readiness',
          () => tmux(['capture-pane', '-p', '-t', name]),
          (text) => text.includes('[fake-codex] READY'),
          30_000,
        )
      const send = async (name: string, text: string) => {
        await tmux(['send-keys', '-l', '-t', name, '--', text])
        await tmux(['send-keys', '-t', name, 'Enter'])
      }
      let child: ChildProcess | undefined
      try {
        child = await start(env, url)
        const created = await post(url, '/sessions', {
          cwd,
          model: 'gpt-5.3-codex',
          effort: 'high',
        })
        const { id, tmuxName, sessionName } = (await created.json()) as NamedSession
        expect(sessionName).toMatch(/^project-[a-z0-9-]+$/)
        expect((await rows(url)).find((row) => row.id === id)).toMatchObject({
          sessionName,
          title: null,
        })
        await ready(tmuxName)
        await until(
          'pending session to be live and waiting',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.status === 'waiting'),
        )
        expect(aliases(appDir)[id]?.codexId).toBeNull()
        const launched = JSON.parse(
          readFileSync(join(codexHome, `launch-${id}.json`), 'utf8'),
        ) as string[]
        expect(launched).toEqual(
          expect.arrayContaining([
            '--model',
            'gpt-5.3-codex',
            '--dangerously-bypass-approvals-and-sandbox',
          ]),
        )
        expect(launched).not.toContain('--no-daemon')
        await post(url, `/sessions/${sessionName}/messages`, { message: 'first prompt' })
        await until(
          'bound rollout to supply title and recap',
          () => rows(url),
          (list) =>
            list.some(
              (row) =>
                row.id === id &&
                row.sessionName === sessionName &&
                row.title === 'first prompt' &&
                row.recap === 'Response to first prompt',
            ),
        )
        const source = { type: 'session', callerSessionId: id }
        const senderHeader = `[Message from session ${id}/${sessionName}]`
        const message = '  bound delivery\n\tsecond line  \n'
        await post(url, `/sessions/${sessionName}/messages`, { message, source })
        await until(
          'attributed multiline queue command to reach the loaded native conversation',
          () => rows(url),
          (list) =>
            list.some(
              (row) => row.id === id && row.recap === `Response to ${senderHeader}\n\n${message}`,
            ),
        )
        writeFileSync(
          join(codexHome, 'sessions', 'unbound-internal.jsonl'),
          JSON.stringify({
            type: 'event_msg',
            payload: { type: 'user_message', message: 'internal thread' },
          }),
        )
        const firstNative = aliases(appDir)[id]!.codexId
        expect(firstNative).not.toBe(id)
        const firstRollout = aliases(appDir)[id]!.transcriptPath!
        const priorRollout = readFileSync(firstRollout, 'utf8')
        const firstTitle = 'Payment queue investigation'
        await send(tmuxName, `/rename ${firstTitle}`)
        await until(
          'idle native rename without a new turn',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.title === firstTitle),
        )
        expect(readFileSync(firstRollout, 'utf8')).toBe(priorRollout)
        await post(url, `/sessions/${sessionName}/messages`, { message: 'ok' })
        const afterFollowUp = await until(
          'follow-up reaches the renamed session',
          () => rows(url),
          (list) =>
            list.some(
              (row) =>
                row.id === id && row.recap === 'Response to [Message from external shell]\n\nok',
            ),
        )
        expect(afterFollowUp.find((row) => row.id === id)).toMatchObject({
          title: firstTitle,
          sessionName,
        })
        const indexPath = join(codexHome, 'session_index.jsonl')
        const externalTitle = 'Renamed by another backend'
        // A separate backend shares the index and sends no notification on this connection.
        appendFileSync(
          indexPath,
          JSON.stringify({
            id: firstNative,
            thread_name: externalTitle,
            updated_at: new Date().toISOString(),
          }) + '\n',
        )
        const externallyRenamed = await until(
          'external rename while the owning backend stays connected',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.title === externalTitle),
        )
        expect(externallyRenamed.find((row) => row.id === id)).toMatchObject({
          status: 'waiting',
          sessionName,
          tmuxName,
        })
        await send(tmuxName, '/work')
        await until(
          'working status from native backend',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.status === 'working'),
        )
        await send(tmuxName, '/approve')
        await until(
          'approval status from native backend',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.status === 'needs-approval'),
        )
        await send(tmuxName, '/clear')
        await until(
          'clear hook to replace binding',
          () => Promise.resolve(aliases(appDir)[id]!.codexId),
          (native) => native !== firstNative,
        )
        const cleared = (await rows(url)).find((row) => row.id === id)!
        expect(cleared).toMatchObject({ sessionName, title: null, recap: null })
        await until(
          'new conversation native idle status',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.status === 'waiting'),
        )
        await post(url, `/sessions/${id}/messages`, { message: 'new conversation', source })
        await until(
          'new native conversation to retain the same Garden sender identity',
          () => rows(url),
          (list) =>
            list.some(
              (row) =>
                row.id === id && row.recap === `Response to ${senderHeader}\n\nnew conversation`,
            ),
        )
        const liveTitle = 'Investigation after clear'
        await send(tmuxName, `/rename ${liveTitle}`)
        await until(
          'new conversation receives its own title',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.title === liveTitle),
        )
        const pending = (await (await post(url, '/sessions', { cwd })).json()) as NamedSession
        expect(pending.sessionName).not.toBe(sessionName)
        await ready(pending.tmuxName)
        const savedIndex = join(codexHome, 'held-session-index.jsonl')
        // Restart Garden without the index so the surviving backend must hydrate the title.
        renameSync(indexPath, savedIndex)
        await stop(child)
        child = await start(env, url)
        await until(
          'native status and title restored after Garden restart',
          () => rows(url),
          (list) =>
            list.some(
              (row) => row.id === id && row.status === 'waiting' && row.title === liveTitle,
            ),
        )
        renameSync(savedIndex, indexPath)
        const restored = await rows(url)
        expect(restored.filter((row) => row.id === id)).toHaveLength(1)
        expect(restored.find((row) => row.id === id)).toMatchObject({
          title: liveTitle,
          status: 'waiting',
          sessionName,
        })
        expect(restored.find((row) => row.id === pending.id)).toMatchObject({
          status: 'waiting',
          sessionName: pending.sessionName,
        })
        await stop(child)
        child = undefined
        await send(pending.tmuxName, 'offline first prompt')
        const spoolDir = join(appDir, 'codex-session-start-spool')
        await until(
          'failed generated SessionStart to be durably spooled',
          () => Promise.resolve(existsSync(spoolDir) ? readdirSync(spoolDir) : []),
          (files) => files.some((file) => file.endsWith('.jsonl')),
        )
        child = await start(env, url)
        await until(
          'boot to bind and replay offline rollout',
          () => rows(url),
          (list) =>
            list.some((row) => row.id === pending.id && row.title === 'offline first prompt'),
        )
        expect(readdirSync(spoolDir)).toEqual([])
        expect((await rows(url)).map((row) => row.id).sort()).toEqual([id, pending.id].sort())
        // Ended bindings remain resumable, and resume addresses the most recent clear id.
        await stop(child)
        child = undefined
        const beforeOfflineClear = aliases(appDir)[id]!.codexId
        await send(tmuxName, '/clear')
        await until(
          'offline clear SessionStart to spool',
          () => Promise.resolve(readdirSync(spoolDir).filter((name) => name.endsWith('.jsonl'))),
          (names) => names.length === 1,
        )
        await send(tmuxName, 'after offline clear')
        const delayedName = readdirSync(spoolDir).find((name) => name.endsWith('.jsonl'))!
        const delayedPath = join(directory, 'delayed-binding.jsonl')
        renameSync(join(spoolDir, delayedName), delayedPath)
        child = await start(env, url)
        expect(aliases(appDir)[id]!.codexId).toBe(beforeOfflineClear)
        // The same failed real hook arrives after boot has already listed the spool.
        renameSync(delayedPath, join(spoolDir, delayedName))
        await until(
          'periodic spool drain to recover a binding missed by boot',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.title === 'after offline clear'),
        )
        expect(readdirSync(spoolDir)).toEqual([])
        const never = (await (await post(url, '/sessions', { cwd })).json()) as NamedSession
        await ready(never.tmuxName)
        await post(url, `/sessions/${never.sessionName}/kill`, {})
        expect(aliases(appDir)[never.id]?.codexId).toBeNull()
        await stop(child)
        child = await start(env, url)
        expect((await rows(url)).find((row) => row.id === never.id)).toMatchObject({
          liveness: 'dead',
          sessionName: never.sessionName,
        })
        const resumed = (await (
          await post(url, `/sessions/${never.sessionName}/resume`, { effort: 'medium' })
        ).json()) as CreateSessionResponse
        expect(resumed.id).toBe(never.id)
        await ready(resumed.tmuxName)
        await until(
          'never-prompted resume to start a fresh Codex process with same garden id',
          () =>
            Promise.resolve(
              JSON.parse(
                readFileSync(join(codexHome, `launch-${never.id}.json`), 'utf8'),
              ) as string[],
            ),
          (args) =>
            args.some((arg) => arg === 'model_reasoning_effort="medium"') &&
            !args.includes('resume'),
        )
        await post(url, `/sessions/${never.sessionName}/messages`, {
          message: 'first after resume',
        })
        await until(
          'resumed pending session to bind',
          () => rows(url),
          (list) => list.some((row) => row.id === never.id && row.title === 'first after resume'),
        )
        const boundAfterClear = aliases(appDir)[id]!.codexId
        expect(boundAfterClear).toEqual(expect.any(String))
        expect(boundAfterClear).not.toBe(beforeOfflineClear)
        const coldTitle = 'Investigation after offline clear'
        await send(tmuxName, `/rename ${coldTitle}`)
        await until(
          'native title after offline binding replay',
          () => rows(url),
          (list) => list.some((row) => row.id === id && row.title === coldTitle),
        )
        const launchPath = join(codexHome, `launch-${id}.json`)
        const launchArgs = () =>
          Promise.resolve(JSON.parse(readFileSync(launchPath, 'utf8')) as string[])
        const remoteEndpoint = (args: string[]) => args[args.indexOf('--remote') + 1]
        const endAndResume = async (
          command: '/end' | '/end-with-slow-shutdown',
          prompt: string,
        ) => {
          let resumeHttp: string | undefined
          try {
            const previousEndpoint = remoteEndpoint(await launchArgs())
            await send(tmuxName, command)
            await until(
              'Garden to report the ended session as dead',
              () => rows(url),
              (list) => list.some((row) => row.id === id && row.liveness === 'dead'),
            )
            if (command === '/end') {
              const pane = await until(
                'tmux to record the prior launcher exit',
                () => paneState(tmuxName),
                (state) =>
                  state.dead && (state.exitStatus !== undefined || state.exitSignal !== undefined),
              )
              expect(pane).toMatchObject({ exitStatus: '0', exitSignal: undefined })
              expect(existsSync(join(appDir, 'native-endpoints', `${id}.json`))).toBe(false)
              if (child) await stop(child)
              child = undefined
              child = await start(env, url)
              expect((await rows(url)).find((row) => row.id === id)).toMatchObject({
                liveness: 'dead',
                title: coldTitle,
                sessionName,
              })
              const cli = async (...args: string[]) =>
                (
                  await exec(
                    process.execPath,
                    ['--import', loader, join(root, 'packages/server/bin/garden.ts'), ...args],
                    { env: { ...env, GARDEN_SERVER_PROCESS: undefined }, timeout: 5000 },
                  )
                ).stdout
              expect((await cli('ls')).split('\n')).toContain(
                [id, 'dead', '-', coldTitle, sessionName].join('\t'),
              )
              expect(
                (JSON.parse(await cli('ls', '--json')) as SessionState[]).find((s) => s.id === id),
              ).toMatchObject({ title: coldTitle, sessionName })
            } else {
              expect((await paneState(tmuxName)).dead).toBe(false)
            }

            const target = command === '/end' ? sessionName : id
            const response = await post(url, `/sessions/${target}/resume`, {})
            const body = await response.text()
            resumeHttp = `${response.status} ${body}`
            const resumed = JSON.parse(body) as CreateSessionResponse
            expect(resumed).toEqual({ id, tmuxName })
            const args = await until(
              'replacement Codex terminal to connect to its new backend',
              launchArgs,
              (launch) => remoteEndpoint(launch) !== previousEndpoint,
            )
            expect(args[0]).toBe('resume')
            expect(args[args.indexOf('--remote') - 1]).toBe(boundAfterClear)
            await ready(resumed.tmuxName)
            if (command === '/end') {
              await post(url, `/sessions/${sessionName}/messages`, { message: prompt })
            } else {
              await send(resumed.tmuxName, prompt)
            }
            const expected =
              command === '/end' ? `[Message from external shell]\n\n${prompt}` : prompt
            const afterResume = await until(
              'replacement terminal to process a new prompt in the same Garden session',
              () => rows(url),
              (list) =>
                list.some((row) => row.id === id && row.recap === `Response to ${expected}`),
            )
            expect(afterResume.find((row) => row.id === id)).toMatchObject({
              title: coldTitle,
              sessionName,
            })
          } catch (error) {
            const [state, output] = await Promise.all([
              paneState(tmuxName)
                .then((pane) => JSON.stringify(pane))
                .catch(() => '(unavailable)'),
              tmux(['capture-pane', '-p', '-S', '-20', '-t', tmuxName])
                .then((pane) => pane.trimEnd().slice(-4096))
                .catch(() => '(unavailable)'),
            ])
            const backend = logTail(join(appDir, 'native-endpoints', `${id}.log`))
            console.error(
              `Fake Codex ${command}/resume failed for ${id}\n` +
                `Resume HTTP: ${resumeHttp ?? '(no successful response)'}\n` +
                `Pane state: ${state}\nPane output:\n${output}\nBackend log tail:\n${backend}`,
            )
            throw error
          }
        }
        await endAndResume('/end', 'after clean exit')
        await endAndResume('/end-with-slow-shutdown', 'after early resume')
      } finally {
        if (child) await stop(child)
        await tmux(['kill-server']).catch(() => {})
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }, 60_000)
})
