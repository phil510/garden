import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, rmdir, unlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const root = join(tmpdir(), `garden-codex-compaction-${process.getuid()}`)
const files = ['compaction-status.md', '.compaction-warned']

async function privateDirectory(path, create = false) {
  if (create)
    await mkdir(path, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || stat.mode & 0o077) {
    throw new Error('Unsafe compaction directory')
  }
  return stat
}

async function regularFile(path) {
  const stat = await lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (stat && (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1)) {
    throw new Error('Unsafe compaction file')
  }
  return stat
}

// Delete only our two files. Unknown contents prevent directory removal; links are never followed.
async function cleanup(directory) {
  await privateDirectory(directory)
  for (const name of files) await regularFile(join(directory, name))
  for (const name of files)
    await unlink(join(directory, name)).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  await rmdir(directory)
}

async function prune() {
  const entries = await opendir(root)
  let checked = 0
  for await (const entry of entries) {
    if (++checked > 100) break
    if (!uuid.test(entry.name)) continue
    const directory = join(root, entry.name)
    try {
      const stat = await privateDirectory(directory)
      if (Date.now() - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000) await cleanup(directory)
    } catch {
      /* Unowned or unexpected paths are left alone. */
    }
  }
}

async function usage(path, sessionId) {
  if (typeof path !== 'string' || !isAbsolute(path)) return null
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!(await handle.stat()).isFile()) return null
    const lines = createInterface({
      input: handle.createReadStream({ autoClose: false }),
      crlfDelay: Infinity,
    })
    let rootSession = false
    let tokens = null
    for await (const line of lines) {
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record?.type === 'session_meta') {
        const meta = record.payload
        rootSession =
          meta?.id === sessionId &&
          typeof meta.source === 'string' &&
          !meta.source.startsWith('subagent')
      } else if (record?.type === 'compacted') {
        tokens = null
      } else if (
        record?.type === 'event_msg' &&
        record.payload?.type === 'token_count' &&
        record.payload.info != null
      ) {
        // Native usage already includes cached/reasoning tokens; cumulative totals count prior turns.
        const count = record.payload.info.last_token_usage?.total_tokens
        tokens = Number.isSafeInteger(count) && count >= 0 ? count : null
      }
    }
    return rootSession ? tokens : null
  } finally {
    await handle.close()
  }
}

function context(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } }
}

async function run(input) {
  const event = input.hook_event_name
  if (
    input.agent_id ||
    !uuid.test(input.session_id ?? '') ||
    !['PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart', 'SessionEnd'].includes(event)
  )
    return
  await privateDirectory(root, true)
  const directory = join(root, input.session_id)
  if (event === 'SessionEnd') {
    await cleanup(directory)
    return
  }
  await privateDirectory(directory, true)
  await utimes(directory, new Date(), new Date())
  const status = join(directory, files[0])
  const marker = join(directory, files[1])
  await regularFile(status)
  await regularFile(marker)
  if (event === 'SessionStart') {
    await prune()
    if (input.source !== 'compact') return
    await unlink(marker).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
    const note = await regularFile(status)
    const recovery = note?.size
      ? `Compaction happened. Read your continuity note at ${JSON.stringify(status)} before continuing. Verify its claims against the repository and the durable work files it points to.`
      : 'Compaction happened, but no continuity note was written. Verify the resumed summary against the repository and durable work files before acting.'
    return context(
      event,
      `${recovery} Re-check available skills, including those the user named earlier; compaction does not cancel those instructions. Reconcile any live agents before resuming their work: compaction does not imply they stopped.`,
    )
  }
  if (await regularFile(marker)) return
  if (event === 'Stop' && input.stop_hook_active) return
  const tokens = await usage(input.transcript_path, input.session_id)
  if (tokens === null || tokens < 175000) return
  // Exclusive creation makes simultaneous hook events deliver only one warning per cycle.
  const note = await open(
    status,
    constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  )
  await note.close()
  const claim = await open(marker, 'wx', 0o600)
  await claim.close()
  const warning = `Context is at or past 175K tokens; compaction may happen soon. Before doing more work, write or overwrite ${JSON.stringify(status)} with roughly 40 lines: your goal, key decisions and why, skills invoked or named by the user, current state, next step, live agent identities and assignments, and pointers to durable work files. This note helps you continue after compaction; write for a reader with no memory of this conversation.`
  // Stop has no additionalContext channel: blocking once supplies native continuation feedback.
  return event === 'Stop' ? { decision: 'block', reason: warning } : context(event, warning)
}

try {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const result = await run(JSON.parse(input))
  if (result) process.stdout.write(`${JSON.stringify(result)}\n`)
} catch {
  // Continuity is best-effort; missing transcripts or unwritable temp storage must not stop work.
}
