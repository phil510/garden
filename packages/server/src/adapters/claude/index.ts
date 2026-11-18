import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseClaudeHook } from './hooks.js'
import { claudeCommand, type ClaudeLaunchOptions } from './commands.js'
import { parseTranscript } from './transcript.js'
import { inScopeDirs } from './slug.js'
import type { TranscriptParse } from '../../domain/transcript.js'

interface RegistryEntry {
  sessionId: string
  name: string
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string' &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}

export interface ClaudeSessionNamesResult {
  names: Record<string, string>
  /** Registry files that named no session — unparseable JSON, or valid JSON missing
   *  `sessionId`/`name`. Mirrors `transcripts.ts`'s skipped-count convention: the read
   *  reports the count and the caller decides whether and how to log it. */
  skipped: number
}

/**
 * Reads every `*.json` file in the Claude session registry and returns the session id to
 * Claude-side name map it describes. The registry is keyed by pid on disk, but garden's
 * `SessionState` carries no pid, so this scans every file and matches by `sessionId` — the
 * same approach `message-session`'s `resolve_session.sh` takes against the same directory.
 * A missing directory resolves to an empty map, matching `listTranscriptFiles`'s ENOENT
 * convention. A single malformed file names no session rather than failing the whole read, so
 * one bad registry entry does not blank out every session's identity.
 *
 * A registry entry can outlive its process (an unclean kill leaves its file behind until
 * cleanup runs), so two files can legitimately name the same `sessionId` — a lingering dead
 * entry and a fresh resume. `resolve_session.sh` treats that as ambiguous and resolves
 * nothing rather than guessing by recency; this scan does the same, dropping the name for a
 * `sessionId` seen more than once so the session degrades to its bare id instead of risking a
 * stale display.
 */
export async function readClaudeSessionNames(
  sessionsDir: string,
): Promise<ClaudeSessionNamesResult> {
  let entries: string[]
  try {
    entries = await readdir(sessionsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { names: {}, skipped: 0 }
    throw error
  }
  const names: Record<string, string> = {}
  const seen = new Set<string>()
  let skipped = 0
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const parsed: unknown = JSON.parse(await readFile(join(sessionsDir, entry), 'utf8'))
      if (!isRegistryEntry(parsed)) {
        skipped += 1
        continue
      }
      if (seen.has(parsed.sessionId)) {
        delete names[parsed.sessionId]
        continue
      }
      seen.add(parsed.sessionId)
      names[parsed.sessionId] = parsed.name
    } catch {
      skipped += 1
    }
  }
  return { names, skipped }
}

interface HookCommand {
  readonly type: 'command'
  readonly command: string
  readonly timeout: number
}
interface HookMatcherGroup {
  readonly matcher?: string
  readonly hooks: readonly HookCommand[]
}
export interface ClaudeSettings {
  readonly hooks: Readonly<Record<string, readonly HookMatcherGroup[]>>
}

// -o /dev/null discards the response because a hook's stdout is interpreted by
// Claude Code; `|| true` keeps a missing server from failing the hook, which for
// PreToolUse would block the tool call. The X-Garden-Session header carries the pane's garden id,
// which the payload's `session_id` stops being after `/clear`.
const HOOK_COMMAND =
  "curl -s -o /dev/null --max-time 1 -H 'Content-Type: application/json' " +
  '-H "X-Garden-Session: $GARDEN_SESSION_ID" --data-binary @- "http://127.0.0.1:$GARDEN_PORT/hooks" || true'

/** Synchronous, never `async: true`: an async hook is killed when claude exits, so SessionEnd
 *  would never land. A down server refuses instantly; `timeout: 1` is Claude Code's own cap,
 *  matching curl's `--max-time`, on the stall when the server is up but unresponsive. */
const POST_HOOK: HookCommand = { type: 'command', command: HOOK_COMMAND, timeout: 1 }

const LIFECYCLE_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'Notification',
] as const
const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PermissionRequest'] as const

export function claudeSettings(): ClaudeSettings {
  const hooks: Record<string, readonly HookMatcherGroup[]> = {}
  // Session-lifecycle events take no matcher; the tool events match every tool.
  for (const event of LIFECYCLE_EVENTS) hooks[event] = [{ hooks: [POST_HOOK] }]
  for (const event of TOOL_EVENTS) hooks[event] = [{ matcher: '*', hooks: [POST_HOOK] }]
  return { hooks }
}

/** Writes the hook overlay, replacing any previous copy, and returns its path. */
export function writeClaudeSettings(appDir: string): string {
  mkdirSync(appDir, { recursive: true })
  const path = join(appDir, 'claude-settings.json')
  writeFileSync(path, `${JSON.stringify(claudeSettings(), null, 2)}\n`, 'utf8')
  return path
}

/** Large enough to hold many lines of an ordinary conversation, small enough that
 *  a multi-megabyte transcript is never read whole. */
export const WINDOW_BYTES = 64 * 1024

/** Every in-scope `*.jsonl` path under `<transcriptsDir>/<slug>/`, one level deep. */
export async function listTranscriptFiles(
  transcriptsDir: string,
  roots: readonly string[],
): Promise<string[]> {
  let dirNames: string[]
  try {
    dirNames = await readdir(transcriptsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: string[] = []
  for (const dir of inScopeDirs(dirNames, roots)) {
    const dirPath = join(transcriptsDir, dir)
    for (const entry of await readdir(dirPath)) {
      if (entry.endsWith('.jsonl')) files.push(join(dirPath, entry))
    }
  }
  return files
}

async function readWindow(path: string, position: number, length: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read({ buffer, position, length })
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * Reads a bounded head and a bounded tail of a transcript file and hands the complete
 * lines within each to the pure parser. The window boundary can fall mid-line, so the
 * first line of the tail read and the last line of the head read are each discarded as
 * possibly cut off — a single line longer than a window is dropped entirely, which is
 * why a returned record can be missing a title or a recap without that being an error.
 *
 * The returned `signature` is the `stat()` taken here, before anything is read, so a write
 * landing after this call only makes it stale — never ahead of what was actually parsed.
 */
export async function readTranscriptRecord(
  path: string,
  windowBytes = WINDOW_BYTES,
): Promise<TranscriptParse & { signature: TranscriptSignature }> {
  const { size, mtimeMs } = await stat(path)
  const signature: TranscriptSignature = { size, mtimeMs }
  const tailStart = Math.max(0, size - windowBytes)
  // The two windows would overlap once the whole file fits in either one, so read it
  // once instead: every line is then known complete and nothing needs discarding.
  if (tailStart <= windowBytes) {
    return { ...parseTranscript(await readFile(path, 'utf8')), signature }
  }
  const headText = await readWindow(path, 0, windowBytes)
  const tailText = await readWindow(path, tailStart, size - tailStart)
  const headLines = headText.split('\n').slice(0, -1)
  const tailLines = tailText.split('\n').slice(1)
  return { ...parseTranscript([...headLines, ...tailLines].join('\n')), signature }
}

export interface TranscriptSignature {
  size: number
  mtimeMs: number
}

export function createClaudeLayout(
  transcriptsDir: string,
  roots: readonly string[],
  logger: { warn(message: string): void },
) {
  let warnedOutside = false
  return {
    listFiles: () => listTranscriptFiles(transcriptsDir, roots),
    accepts(path: string): boolean {
      const segments = relative(transcriptsDir, path).split(sep)
      if (segments[0] === '..' || segments[0] === '') {
        if (!warnedOutside) {
          warnedOutside = true
          logger.warn(`ignoring transcript path outside ${transcriptsDir}: ${path}`)
        }
        return false
      }
      const [dir, name] = segments
      return (
        segments.length === 2 &&
        dir !== '' &&
        dir !== '..' &&
        name!.endsWith('.jsonl') &&
        inScopeDirs([dir!], roots).length > 0
      )
    },
    readRecord: (path: string) => readTranscriptRecord(path),
  }
}

export function createClaudeHarness(options: {
  readonly appDir: string
  readonly logger: { warn(message: string): void }
  readonly readCommand: () => readonly string[]
  readonly transcriptsDir: string
  readonly roots: readonly string[]
  readonly sessionsDir: string
}) {
  const settingsPath = writeClaudeSettings(options.appDir)
  return {
    spawnCommand: (request: ClaudeLaunchOptions) =>
      claudeCommand(options.readCommand(), 'spawn', settingsPath, request),
    resumeCommand: (request: ClaudeLaunchOptions) =>
      claudeCommand(options.readCommand(), 'resume', settingsPath, request),
    parseHook: parseClaudeHook,
    transcripts: createClaudeLayout(options.transcriptsDir, options.roots, options.logger),
    readSessionNames: () => readClaudeSessionNames(options.sessionsDir),
  }
}
