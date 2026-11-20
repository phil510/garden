import WebSocket from 'ws'
import type { HarnessSignal, ReportedStatus } from '../../domain/types.js'
import { readCodexEndpoint, type CodexEndpoint } from './launcher.js'

export interface NativeBinding {
  id: string
  cwd: string
  codexId: string
  transcriptPath: string
  generation: number
  backendGeneration?: string | undefined
}

export function nativeStatus(value: unknown): ReportedStatus {
  const status = value as { type?: unknown; activeFlags?: unknown } | null
  if (status?.type === 'active')
    return {
      status:
        Array.isArray(status.activeFlags) && status.activeFlags.includes('waitingOnApproval')
          ? 'needs-approval'
          : 'working',
      reason: null,
    }
  return { status: status?.type === 'idle' ? 'waiting' : 'unknown', reason: null }
}

function nativeTitle(name: unknown): string | null | undefined {
  if (name == null) return null
  if (typeof name === 'string') return name.trim() === '' ? null : name
  return undefined
}

function observerKey(binding: NativeBinding, endpoint: CodexEndpoint | null): string {
  return JSON.stringify([binding.codexId, binding.generation, endpoint])
}

/** A passive connection observes only the TUI's already-bound thread. It never owns a turn. */
export function observeNativeStatus(options: {
  appDir: string
  bindings: () => NativeBinding[]
  onSignal: (signal: HarnessSignal) => void
  onTitle?: (binding: NativeBinding, title: string | null) => void
  rebind?: (binding: NativeBinding, path: string, preserveTitle: boolean) => NativeBinding | null
  pollMs?: number
}) {
  const entries = new Map<string, { key: string; socket?: WebSocket; stop: () => void }>()
  let closed = false
  function refresh() {
    if (closed) return
    const bindings = options.bindings()
    for (const [id, entry] of entries) {
      if (!bindings.some((binding) => binding.id === id)) {
        entry.stop()
        entries.delete(id)
      }
    }
    for (let binding of bindings) {
      const descriptor = readCodexEndpoint(options.appDir, binding.id)
      const endpoint = descriptor?.generation === binding.backendGeneration ? descriptor : null
      const key = observerKey(binding, endpoint)
      const prior = entries.get(binding.id)
      if (
        prior?.key === key &&
        (prior.socket === undefined || prior.socket.readyState < WebSocket.CLOSING)
      )
        continue
      prior?.stop()
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const current = () =>
        !closed &&
        !stopped &&
        options
          .bindings()
          .some(
            (b) =>
              b.id === binding.id &&
              b.codexId === binding.codexId &&
              b.transcriptPath === binding.transcriptPath &&
              b.generation === binding.generation &&
              b.backendGeneration === binding.backendGeneration,
          ) &&
        JSON.stringify(readCodexEndpoint(options.appDir, binding.id)) === JSON.stringify(descriptor)
      function report(reported: ReportedStatus | undefined, resetConversation = false) {
        const fresh = current()
        // An endpoint can disappear after we commit its replacement path.
        if (!fresh && !resetConversation) return
        options.onSignal({
          sessionId: binding.id,
          cwd: binding.cwd,
          transcriptPath: binding.transcriptPath,
          ...(fresh && reported !== undefined ? { reported } : {}),
          ended: null,
          conversationCleared: false,
          ...(resetConversation ? { resetConversation: true } : {}),
        })
      }
      if (endpoint === null) {
        entries.set(binding.id, {
          key,
          stop: () => {
            stopped = true
          },
        })
        report(nativeStatus(null))
        continue
      }
      const socket = new WebSocket(`ws+unix://${endpoint.endpoint.slice('unix://'.length)}:/`, {
        handshakeTimeout: 5000,
      })
      const entry = {
        key,
        socket,
        stop: () => {
          stopped = true
          clearTimeout(timer)
          socket.terminate()
        },
      }
      entries.set(binding.id, entry)
      report(nativeStatus(null))
      let statusRevision = 0
      let titleRevision = 0
      let snapshotStatusRevision = 0
      let snapshotTitleRevision = 0
      let awaitingSnapshot = false
      function deadline() {
        clearTimeout(timer)
        timer = setTimeout(() => socket.terminate(), 5000)
        timer.unref()
      }
      socket.on('open', () => {
        if (!current()) {
          socket.terminate()
          return
        }
        deadline()
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'initialize',
            params: {
              clientInfo: { name: 'garden_status_observer', version: '0.0.0' },
              capabilities: { experimentalApi: true, requiredHumanApproval: false },
            },
          }),
        )
      })
      socket.on('message', (data) => {
        if (!current()) return
        let message: {
          id?: number
          method?: string
          error?: unknown
          result?: { thread?: { id?: string; status?: unknown; name?: unknown; path?: unknown } }
          params?: { threadId?: string; status?: unknown; threadName?: unknown }
        }
        try {
          const bytes = Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.isBuffer(data)
              ? data
              : Buffer.from(data)
          message = JSON.parse(bytes.toString('utf8')) as typeof message
        } catch {
          return
        }
        if (message === null || typeof message !== 'object') return
        // Native server requests belong to the TUI; never answer them or treat their arrival as approval state.
        if (message.method !== undefined) {
          if (message.id !== undefined || message.params?.threadId !== binding.codexId) return
          if (message.method === 'thread/reverted') {
            entry.stop()
            refresh()
          } else if (message.method === 'thread/status/changed') {
            statusRevision++
            report(nativeStatus(message.params.status))
          } else if (message.method === 'thread/name/updated') {
            const title = nativeTitle(message.params.threadName)
            if (title !== undefined) {
              titleRevision++
              options.onTitle?.(binding, title)
            }
          }
          return
        }
        if (message.error !== undefined) {
          socket.terminate()
          return
        }
        if (message.id === 1) {
          socket.send(JSON.stringify({ method: 'initialized' }))
          snapshotStatusRevision = statusRevision
          snapshotTitleRevision = titleRevision
          awaitingSnapshot = true
          deadline()
          socket.send(
            JSON.stringify({
              id: 2,
              method: 'thread/read',
              params: { threadId: binding.codexId, includeTurns: false },
            }),
          )
        } else if (message.id === 2 && awaitingSnapshot) {
          awaitingSnapshot = false
          clearTimeout(timer)
          const thread = message.result?.thread
          if (thread?.id !== binding.codexId) return
          const replacement =
            typeof thread.path === 'string' && thread.path !== binding.transcriptPath
              ? options.rebind?.(binding, thread.path, titleRevision > 0)
              : null
          if (replacement != null) {
            binding = replacement
            entry.key = observerKey(binding, endpoint)
          }
          if (titleRevision === snapshotTitleRevision && current()) {
            const title = nativeTitle(thread.name)
            if (title !== undefined) options.onTitle?.(binding, title)
          }
          if (statusRevision === snapshotStatusRevision) {
            report(nativeStatus(thread.status), replacement != null)
          } else if (replacement != null) report(undefined, true)
        }
      })
      socket.on('error', () => {
        socket.terminate()
      })
      socket.on('close', () => {
        clearTimeout(timer)
        report(nativeStatus(null))
      })
    }
  }
  const poll = setInterval(refresh, options.pollMs ?? 500)
  poll.unref()
  refresh()
  return {
    refresh,
    close() {
      closed = true
      clearInterval(poll)
      for (const entry of entries.values()) entry.stop()
      entries.clear()
    },
  }
}
