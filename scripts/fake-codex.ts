import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createServer } from 'node:http'
import { once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'

const args = process.argv.slice(2)
const home = process.env.CODEX_HOME
if (home === undefined) throw new Error('fake Codex requires its own CODEX_HOME')
const queueDir = join(home, 'queue')
const indexPath = join(home, 'session_index.jsonl')
mkdirSync(queueDir, { recursive: true })
const remote = args[args.indexOf('--remote') + 1]
if (args.includes('--remote')) {
  const endpoint = remote!.replace(/^unix:\/\//, '')
  const client = new WebSocket(`ws+unix://${endpoint}:/`)
  await once(client, 'open')
  if (args.includes('queue')) {
    client.send(
      JSON.stringify({
        method: 'fake/queue',
        params: {
          threadId: args[args.indexOf('--thread') + 1],
          message: args.find((arg) => arg.startsWith('--message='))?.slice('--message='.length),
        },
      }),
    )
    await once(client, 'message')
    client.close()
  } else {
    client.on('message', (data) => {
      const message = JSON.parse(
        (Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : data
        ).toString('utf8'),
      ) as { method: string; params?: string }
      if (message.method === 'fake/output') console.log(message.params)
      if (message.method === 'fake/end') client.close()
    })
    client.send(JSON.stringify({ method: 'fake/start', params: { args } }))
    const input = createInterface({ input: process.stdin })
    input.on('line', (line) => client.send(JSON.stringify({ method: 'fake/input', params: line })))
    await once(client, 'close')
    input.close()
  }
  process.exit(0)
}
if (args.includes('queue')) {
  const id = args[args.indexOf('--thread') + 1]
  const message = args.find((arg) => arg.startsWith('--message='))?.slice('--message='.length)
  if (!id || message === undefined) throw new Error('queue requires thread and message')
  appendFileSync(join(queueDir, `${id}.jsonl`), `${JSON.stringify(message)}\n`)
  process.exit(0)
}

const commands = new Map<string, string>()
for (let index = 0; index < args.length - 1; index += 1) {
  if (args[index] !== '-c') continue
  const overlay = args[index + 1]!
  const event = /^hooks\.([A-Za-z]+)=/.exec(overlay)?.[1]
  const encoded = /command=(.*),timeout=\d+/.exec(overlay)?.[1]
  if (event !== undefined && encoded !== undefined)
    commands.set(event, JSON.parse(encoded) as string)
}
if (!commands.has('SessionStart'))
  throw new Error('fake Codex requires real injected hook commands')
let id: string = randomUUID()
let path: string | null = null
let source = 'startup'
let started = false
let title: string | null = null
let queuePosition = 0
let status: { type: string; activeFlags?: string[] } = { type: 'idle' }
const observers = new Set<WebSocket>()
let terminal: WebSocket | undefined
function report(next: typeof status) {
  status = next
  for (const client of observers)
    client.send(
      JSON.stringify({
        method: 'thread/status/changed',
        params: { threadId: id, status },
      }),
    )
}
function output(text: string) {
  terminal?.send(JSON.stringify({ method: 'fake/output', params: text }))
}

function materialize() {
  const directory = join(home!, 'sessions', '2026', '11', '15')
  mkdirSync(directory, { recursive: true })
  path = join(directory, `rollout-${id}.jsonl`)
  if (!existsSync(path)) append('session_meta', { id, session_id: id, cwd: process.cwd() })
}
function append(type: string, payload: unknown) {
  if (path === null) throw new Error('rollout not materialized')
  appendFileSync(
    path,
    `${JSON.stringify({ type, payload, timestamp: new Date().toISOString() })}\n`,
  )
}
async function hook(event: string): Promise<void> {
  const command = commands.get(event)
  if (command === undefined) throw new Error(`missing hook ${event}`)
  await new Promise<void>((resolve, reject) => {
    const child = execFile('sh', ['-c', command], { timeout: 5000 }, (error) =>
      error ? reject(new Error(error.message)) : resolve(),
    )
    child.stdin!.end(
      JSON.stringify({
        hook_event_name: event,
        session_id: id,
        transcript_path: path,
        cwd: process.cwd(),
        source,
      }),
    )
  })
}
async function turn(message: string) {
  if (message === '/end-with-slow-shutdown') {
    // Leave the terminal open after the hook and make the launcher reap this backend.
    process.once('SIGTERM', () => {})
    await hook('SessionEnd')
    return
  }
  if (message === '/end') {
    await hook('SessionEnd')
    terminal?.send(JSON.stringify({ method: 'fake/end' }))
    return
  }
  if (message === '/approve') {
    await hook('PermissionRequest')
    report({ type: 'active', activeFlags: ['waitingOnApproval'] })
    return
  }
  if (message === '/wait') {
    await hook('Stop')
    report({ type: 'idle' })
    return
  }
  if (message === '/clear') {
    id = randomUUID()
    path = null
    title = null
    source = 'clear'
    started = true
    queuePosition = 0
    materialize()
    await hook('SessionStart')
    report({ type: 'idle' })
    output(`[fake-codex] CLEARED ${id}`)
    return
  }
  if (message.startsWith('/rename ')) {
    title = message.slice('/rename '.length).trim()
    appendFileSync(
      indexPath,
      `${JSON.stringify({ id, thread_name: title, updated_at: new Date().toISOString() })}\n`,
    )
    for (const client of observers)
      client.send(
        JSON.stringify({
          method: 'thread/name/updated',
          params: { threadId: id, threadName: title },
        }),
      )
    return
  }
  materialize()
  // The input hook may precede binding; SessionStart must preserve its working status.
  report({ type: 'active', activeFlags: [] })
  await hook('UserPromptSubmit')
  if (!started) {
    started = true
    await hook('SessionStart')
  }
  append('response_item', {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: message }],
    internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
  })
  if (message === '/work') {
    await hook('PreToolUse')
    return
  }
  append('response_item', {
    type: 'message',
    role: 'assistant',
    phase: 'final_answer',
    content: [{ type: 'output_text', text: `Response to ${message}` }],
  })
  await hook('Stop')
  report({ type: 'idle' })
}

let pending = Promise.resolve()
const server = createServer()
const sockets = new WebSocketServer({ server })
sockets.on('connection', (client) => {
  client.on('close', () => observers.delete(client))
  client.on('message', (data) => {
    const message = JSON.parse(
      (Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : data
      ).toString('utf8'),
    ) as {
      id?: number
      method: string
      params: { args?: string[]; threadId?: string; message?: string } | string
    }
    const params = typeof message.params === 'object' ? message.params : {}
    if (message.method === 'initialize') {
      observers.add(client)
      client.send(JSON.stringify({ id: message.id, result: {} }))
    } else if (message.method === 'thread/read') {
      client.send(
        JSON.stringify({ id: message.id, result: { thread: { id, status, name: title } } }),
      )
    } else if (message.method === 'fake/start') {
      terminal = client
      const launch = params.args!
      const resume = launch.indexOf('resume')
      if (resume >= 0) {
        id = launch.slice(resume + 1).find((arg) => /^[0-9a-f-]{36}$/.test(arg))!
        source = 'resume'
        if (existsSync(indexPath)) {
          const rows = readFileSync(indexPath, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { id: string; thread_name: string })
          title = rows.findLast((row) => row.id === id)?.thread_name ?? null
        }
      }
      const record = join(home, `launch-${process.env.GARDEN_SESSION_ID ?? 'unknown'}.json`)
      const temporary = `${record}.${process.pid}.tmp`
      writeFileSync(temporary, JSON.stringify(launch))
      renameSync(temporary, record)
      output('[fake-codex] READY')
    } else if (message.method === 'fake/input' || message.method === 'fake/queue') {
      const text = typeof message.params === 'string' ? message.params : params.message!
      pending = pending
        .then(() => turn(text))
        .then(() => {
          if (message.method === 'fake/queue') client.send(JSON.stringify({ ok: true }))
        })
        .catch((error: unknown) => console.error(error))
    }
  })
})
const listen = args[args.indexOf('--listen') + 1]
if (!args.includes('app-server') || !listen)
  throw new Error('fake Codex requires app-server --listen')
server.listen(listen.replace(/^unix:\/\//, ''))
setInterval(() => {
  const queue = join(queueDir, `${id}.jsonl`)
  if (!existsSync(queue)) return
  const messages = readFileSync(queue, 'utf8').trim().split('\n').filter(Boolean)
  const unseen = messages.slice(queuePosition)
  queuePosition = messages.length
  for (const encoded of unseen) pending = pending.then(() => turn(JSON.parse(encoded) as string))
}, 40).unref()
