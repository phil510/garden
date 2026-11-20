import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import type { EffortLevel } from '@garden/shared'
import type { PermissionMode } from '../../config.js'
import { codexHook, codexSignal } from './hooks.js'
import { codexLauncherCommand, readCodexEndpoint } from './launcher.js'
import { observeNativeStatus } from './nativeStatus.js'
import { createSessionIndex, indexHasCaughtUp } from './sessionIndex.js'
import { parseCodexTranscript } from './transcript.js'
import type { HarnessSignal, TranscriptRecord } from '../../domain/types.js'

const execFileAsync = promisify(execFile)

interface Alias {
  cwd: string
  name: string
  codexId: string | null
  transcriptPath: string | null
  bindingOrder?: string
  backendGeneration?: string
}
interface Launch {
  id: string
  cwd: string
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
}
interface Options {
  appDir: string
  codexHome: string
  instanceEnv: Readonly<Record<string, string>>
  /** Read-only Codex session roots; never recursively scanned. */
  transcriptRoots: readonly string[]
  command?: readonly string[]
  readCommand?: () => readonly string[]
  logger: { warn(message: string): void }
  /** The real read can be delayed independently of a rebind in tests. */
  readText?: (path: string) => Promise<string>
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function validGardenId(id: string): boolean {
  return /^[a-z0-9_-]{1,128}$/i.test(id)
}
function validNativeId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
}
function within(root: string, path: string): boolean {
  const suffix = relative(root, path)
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

function allocateName(cwd: string, id: string, taken: ReadonlySet<string>): string {
  const project = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 24)
    .replace(/^-|-$/g, '')
  const suffix = createHash('sha256').update(id).digest('hex').slice(0, 6)
  const base = `${project || 'session'}-${suffix}`
  let name = base
  for (let index = 2; taken.has(name); index += 1) name = `${base}-${index}`
  return name
}

export function createCodexHarness(options: Options) {
  const aliasPath = join(options.appDir, 'codex-aliases.json')
  const spoolDir = join(options.appDir, 'codex-session-start-spool')
  const hookArguments = codexHookArguments(options.appDir)
  const readCommand =
    options.readCommand ?? (() => (options.command?.length ? options.command : ['codex']))
  const readText = options.readText ?? ((path: string) => readFile(path, 'utf8'))
  const recordBindings = new WeakMap<
    TranscriptRecord,
    { id: string; generation: number; path: string }
  >()
  const generations = new Map<string, number>()
  const launches = new Map<string, { reported: boolean }>()
  const readSessionIndex = createSessionIndex(options.codexHome)
  const liveTitles = new Map<
    string,
    { generation: number; title: string | null; observedAt: number }
  >()
  let aliases: Record<string, Alias> = Object.create(null) as Record<string, Alias>

  function validPath(path: unknown): path is string {
    return (
      typeof path === 'string' &&
      isAbsolute(path) &&
      path.endsWith('.jsonl') &&
      options.transcriptRoots.some((root) => within(root, path))
    )
  }
  if (existsSync(aliasPath)) {
    const stored = object(JSON.parse(readFileSync(aliasPath, 'utf8')))
    const sessions = object(stored?.['sessions'])
    if (stored?.['version'] !== 1 || sessions === null)
      throw new Error(`invalid Codex aliases: ${aliasPath}`)
    const legacy: [string, Omit<Alias, 'name'>][] = []
    const names = new Set<string>()
    for (const [id, raw] of Object.entries(sessions)) {
      const entry = object(raw)
      if (
        !validGardenId(id) ||
        entry === null ||
        typeof entry['cwd'] !== 'string' ||
        !isAbsolute(entry['cwd']) ||
        (entry['codexId'] !== null && !validNativeId(entry['codexId'])) ||
        (entry['transcriptPath'] !== null && !validPath(entry['transcriptPath'])) ||
        (entry['codexId'] === null) !== (entry['transcriptPath'] === null) ||
        (entry['backendGeneration'] !== undefined &&
          (typeof entry['backendGeneration'] !== 'string' ||
            !/^[a-z0-9-]{1,128}$/i.test(entry['backendGeneration']))) ||
        (entry['bindingOrder'] !== undefined &&
          (typeof entry['bindingOrder'] !== 'string' || !/^\d{1,30}$/.test(entry['bindingOrder'])))
      )
        throw new Error(`invalid Codex alias for ${id}`)
      const name = entry['name']
      if (name === undefined) legacy.push([id, entry as unknown as Omit<Alias, 'name'>])
      else {
        if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || names.has(name))
          throw new Error(`invalid Codex alias name for ${id}`)
        names.add(name)
        aliases[id] = entry as unknown as Alias
      }
    }
    for (const [id, entry] of legacy) {
      const name = allocateName(entry.cwd, id, names)
      names.add(name)
      aliases[id] = { ...entry, name }
    }
    if (legacy.length > 0) save(aliases)
  }

  function save(next: Record<string, Alias>): void {
    const temporary = `${aliasPath}.${randomUUID()}.tmp`
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(fd, `${JSON.stringify({ version: 1, sessions: next }, null, 2)}\n`)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, aliasPath)
    const dir = openSync(options.appDir, 'r')
    try {
      fsyncSync(dir)
    } finally {
      closeSync(dir)
    }
    aliases = Object.assign(Object.create(null) as Record<string, Alias>, next)
  }

  function ownedByAnother(gardenId: string, codexId: string, path: string): boolean {
    return Object.entries(aliases).some(
      ([id, alias]) =>
        id !== gardenId && (alias.codexId === codexId || alias.transcriptPath === path),
    )
  }

  function invalidateBinding(id: string): number {
    const generation = (generations.get(id) ?? 0) + 1
    generations.set(id, generation)
    liveTitles.delete(id)
    return generation
  }

  function parseHook(body: unknown, gardenSessionId?: string): HarnessSignal | null {
    const hook = codexHook(body)
    if (hook === null || gardenSessionId === undefined || !isAbsolute(hook.cwd)) return null
    const prior = aliases[gardenSessionId]
    if (prior === undefined) return null
    const endpoint = readCodexEndpoint(options.appDir, gardenSessionId)
    if (endpoint !== null && hook._garden_generation !== endpoint.generation) return null
    if (hook.transcript_path !== null && !validPath(hook.transcript_path)) return null
    let resetConversation = false
    let conversationCleared = false
    if (hook.hook_event_name === 'SessionStart') {
      if (!['startup', 'resume', 'clear', 'fork', 'compact'].includes(hook.source ?? ''))
        return null
      const orderDifference =
        hook._garden_order === undefined || prior.bindingOrder === undefined
          ? undefined
          : BigInt(hook._garden_order) - BigInt(prior.bindingOrder)
      if (orderDifference !== undefined && orderDifference < 0n) return null
      if (hook.transcript_path !== null) {
        const changed =
          prior.codexId !== hook.session_id || prior.transcriptPath !== hook.transcript_path
        if (ownedByAnother(gardenSessionId, hook.session_id, hook.transcript_path)) return null
        resetConversation = changed && prior.codexId !== null
        conversationCleared =
          resetConversation && (hook.source === 'clear' || hook.source === 'fork')
        if (resetConversation) {
          // Replaying the hook that established the retired path must not undo a native update.
          if (orderDifference === 0n) return null
          if (
            !conversationCleared &&
            (hook.source !== 'resume' ||
              prior.codexId !== hook.session_id ||
              (prior.bindingOrder !== undefined && hook._garden_order === undefined))
          )
            return null
        }
        const bindingOrder = hook._garden_order ?? prior.bindingOrder
        if (
          changed ||
          bindingOrder !== prior.bindingOrder ||
          hook._garden_generation !== prior.backendGeneration
        ) {
          save({
            ...aliases,
            [gardenSessionId]: {
              cwd: hook.cwd,
              name: prior.name,
              codexId: hook.session_id,
              transcriptPath: hook.transcript_path,
              ...(bindingOrder === undefined ? {} : { bindingOrder }),
              ...(hook._garden_generation === undefined
                ? {}
                : { backendGeneration: hook._garden_generation }),
            },
          })
        }
      }
    } else if (prior.codexId !== null && prior.codexId !== hook.session_id) return null
    const signal = codexSignal(hook, gardenSessionId, conversationCleared)
    if (resetConversation) invalidateBinding(gardenSessionId)
    return {
      ...signal,
      ...(resetConversation ? { resetConversation: true } : {}),
    }
  }

  function flags(request: Launch): readonly string[] {
    if (request.model !== undefined && /^(?:opus|sonnet|haiku)(?:-|$)/.test(request.model))
      throw new Error('Choose a Codex model name, such as gpt-5.3-codex')
    if (request.effort === 'max')
      throw new Error('Codex supports effort through xhigh; choose xhigh instead of max')
    return [
      ...(request.permissionMode === 'bypassPermissions'
        ? ['--dangerously-bypass-approvals-and-sandbox']
        : []),
      ...(request.model === undefined ? [] : ['--model', request.model]),
      ...(request.effort === undefined
        ? []
        : ['-c', `model_reasoning_effort=${JSON.stringify(request.effort)}`]),
    ]
  }

  function launchCommand(request: Launch, terminalCommand: readonly string[]) {
    const shellContext = { ...options.instanceEnv, GARDEN_SESSION_ID: request.id }
    return codexLauncherCommand({
      appDir: options.appDir,
      id: request.id,
      cwd: request.cwd,
      backendCommand: [
        ...readCommand(),
        'app-server',
        ...hookArguments,
        ...Object.entries(shellContext).flatMap(([name, value]) => [
          '-c',
          `shell_environment_policy.set.${name}=${JSON.stringify(value)}`,
        ]),
      ],
      terminalCommand,
    })
  }

  return {
    initialStatus: { status: 'waiting' as const, reason: null },
    beforeLaunch(request: Launch) {
      if (!validGardenId(request.id) || !isAbsolute(request.cwd))
        throw new Error('invalid Codex launch identity or cwd')
      const prior = aliases[request.id]
      const entry = prior ?? {
        cwd: request.cwd,
        name: allocateName(
          request.cwd,
          request.id,
          new Set(Object.values(aliases).map((alias) => alias.name)),
        ),
        codexId: null,
        transcriptPath: null,
      }
      if (prior === undefined) save({ ...aliases, [request.id]: entry })
      const launch = { reported: false }
      launches.set(request.id, launch)
      return {
        sessionName: entry.name,
        rollback() {
          launches.delete(request.id)
          if (prior !== undefined || aliases[request.id] !== entry) return
          const next = { ...aliases }
          delete next[request.id]
          save(next)
        },
        registrationStatus() {
          launches.delete(request.id)
          return launch.reported
            ? undefined
            : {
                status:
                  aliases[request.id]?.codexId == null
                    ? ('waiting' as const)
                    : ('unknown' as const),
                reason: null,
              }
        },
      }
    },
    spawnCommand(request: Launch): readonly string[] {
      return launchCommand(request, [...readCommand(), ...flags(request)])
    },
    resumeCommand(request: Launch): readonly string[] {
      const alias = aliases[request.id]
      if (alias === undefined) throw new Error(`no Codex binding for ${request.id}`)
      return launchCommand(
        request,
        alias.codexId === null
          ? [...readCommand(), ...flags(request)]
          : [...readCommand(), 'resume', ...flags(request), alias.codexId],
      )
    },
    parseHook,
    observeStatus(onSignal: (signal: HarnessSignal) => void) {
      return observeNativeStatus({
        appDir: options.appDir,
        onSignal: (signal) => {
          const launch = launches.get(signal.sessionId)
          if (launch !== undefined) launch.reported = true
          onSignal(signal)
        },
        onTitle: (binding, title) =>
          liveTitles.set(binding.id, {
            generation: binding.generation,
            title,
            observedAt: Date.now(),
          }),
        bindings: () =>
          Object.entries(aliases).flatMap(([id, alias]) =>
            alias.codexId === null || alias.transcriptPath === null
              ? []
              : [
                  {
                    id,
                    cwd: alias.cwd,
                    codexId: alias.codexId,
                    transcriptPath: alias.transcriptPath,
                    generation: generations.get(id) ?? 0,
                    backendGeneration: alias.backendGeneration,
                  },
                ],
          ),
      })
    },
    pendingSessions() {
      return Object.entries(aliases)
        .filter(([, alias]) => alias.codexId === null)
        .map(([id, alias]) => ({ id, cwd: alias.cwd }))
    },
    replaySpool(): HarnessSignal[] {
      if (!existsSync(spoolDir)) return []
      const signals: HarnessSignal[] = []
      for (const name of readdirSync(spoolDir)
        .filter((name) => name.endsWith('.jsonl'))
        .sort()) {
        const path = join(spoolDir, name)
        try {
          const value = object(JSON.parse(readFileSync(path, 'utf8')))
          if (
            value === null ||
            typeof value['gardenSessionId'] !== 'string' ||
            codexHook(value['payload'])?.hook_event_name !== 'SessionStart'
          ) {
            options.logger.warn(`invalid Codex binding spool retained: ${name}`)
            continue
          }
          const signal = parseHook(value['payload'], value['gardenSessionId'])
          if (signal !== null) signals.push(signal)
          unlinkSync(path)
        } catch (error) {
          options.logger.warn(
            `Codex binding spool replay failed for ${name}: ${(error as Error).message}`,
          )
        }
      }
      return signals
    },
    async sendMessage(
      id: string,
      message: string,
      submitPending: () => Promise<void>,
    ): Promise<void> {
      const alias = aliases[id]
      if (alias === undefined) throw new Error(`no Codex binding for ${id}`)
      if (alias.codexId === null) {
        await submitPending()
        return
      }
      try {
        const command = readCommand()
        const endpoint = readCodexEndpoint(options.appDir, id)
        await execFileAsync(
          command[0]!,
          [
            ...command.slice(1),
            'queue',
            ...(endpoint === null ? [] : ['--remote', endpoint.endpoint]),
            '--thread',
            alias.codexId,
            `--message=${message}`,
          ],
          { timeout: 15_000, maxBuffer: 1024 * 1024 },
        )
      } catch (cause) {
        throw new Error('Codex could not queue the message', { cause })
      }
    },
    transcripts: {
      isCurrent(path: string, record: TranscriptRecord): boolean {
        const binding = recordBindings.get(record)
        return (
          binding !== undefined &&
          binding.path === path &&
          aliases[binding.id]?.transcriptPath === path &&
          (generations.get(binding.id) ?? 0) === binding.generation
        )
      },
      listFiles(): Promise<string[]> {
        return Promise.resolve(
          Object.values(aliases).flatMap((alias) =>
            alias.transcriptPath === null ? [] : [alias.transcriptPath],
          ),
        )
      },
      accepts(path: string): boolean {
        return Object.values(aliases).some((alias) => alias.transcriptPath === path)
      },
      async readRecord(path: string) {
        const binding = Object.entries(aliases).find(([, alias]) => alias.transcriptPath === path)
        if (binding === undefined) return null
        const [id, alias] = binding
        const generation = generations.get(id) ?? 0
        const { size, mtimeMs } = await stat(path)
        const contents = await readText(path)
        if ((generations.get(id) ?? 0) !== generation || aliases[id]?.transcriptPath !== path)
          return null
        const parsed = parseCodexTranscript(contents, id)
        const record = { ...parsed.record, cwd: parsed.record.cwd ?? alias.cwd }
        recordBindings.set(record, { id, generation, path })
        return { ...parsed, record, signature: { size, mtimeMs } }
      },
    },
    async readSessionMetadata() {
      const indexedTitles = await readSessionIndex()
      const names: Record<string, string> = Object.create(null) as Record<string, string>
      const nativeTitles: Record<string, string> = Object.create(null) as Record<string, string>
      for (const [id, alias] of Object.entries(aliases)) {
        names[id] = alias.name
        if (alias.codexId === null) continue
        const indexed = indexedTitles.get(alias.codexId)
        const live = liveTitles.get(id)
        let title = indexed?.title ?? null
        if (
          live !== undefined &&
          live.generation === (generations.get(id) ?? 0) &&
          !indexHasCaughtUp(indexed, live)
        ) {
          // Codex can report a rename even when its index append fails.
          title = live.title
        }
        if (title !== null) nativeTitles[id] = title
      }
      return { names, nativeTitles, skipped: 0 }
    },
  }
}

const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'Interrupt',
]

// A separate file per failed binding makes acknowledgement an unlink, so an append
// racing boot replay cannot be truncated away. The order also survives a lost HTTP reply.
const HOOK_SCRIPT = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(input); } catch { return; }
  if (process.env.GARDEN_CODEX_GENERATION) payload._garden_generation = process.env.GARDEN_CODEX_GENERATION;
  payload._garden_order = Math.floor((performance.timeOrigin + performance.now()) * 1000).toString();
  const body = JSON.stringify(payload);
  let finished = false;
  function finish(ok) {
    if (finished) return;
    finished = true;
    if (!ok && payload.hook_event_name === 'SessionStart' && process.env.GARDEN_SESSION_ID) {
      const dir = process.argv[2];
      fs.mkdirSync(dir, {recursive:true});
      const name = payload._garden_order.padStart(30, '0') + '-' + crypto.randomUUID() + '.jsonl';
      const temporary = path.join(dir, name + '.tmp');
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({gardenSessionId:process.env.GARDEN_SESSION_ID,payload}) + '\n');
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, path.join(dir, name));
      const directory = fs.openSync(dir, 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  }
  const request = http.request({hostname:'127.0.0.1',port:process.env.GARDEN_PORT,path:'/hooks',method:'POST',headers:{'Content-Type':'application/json','X-Garden-Session':process.env.GARDEN_SESSION_ID || ''}}, response => {
    response.resume();
    response.on('end', () => finish(response.statusCode >= 200 && response.statusCode < 300));
  });
  request.setTimeout(750, () => { request.destroy(); finish(false); });
  request.on('error', () => finish(false));
  request.end(body);
});
`

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function codexHookArguments(appDir: string): readonly string[] {
  mkdirSync(appDir, { recursive: true })
  const script = join(appDir, 'codex-hook.cjs')
  writeFileSync(script, HOOK_SCRIPT, { mode: 0o600 })
  const command = `${shellQuote(process.execPath)} ${shellQuote(script)} ${shellQuote(join(appDir, 'codex-session-start-spool'))} || true`
  return EVENTS.flatMap((event) => [
    '-c',
    `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(command)},timeout=2}]}]`,
  ])
}
