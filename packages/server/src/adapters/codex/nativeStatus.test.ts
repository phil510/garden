import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeStatus, observeNativeStatus, type NativeBinding } from './nativeStatus.js'
import type { HarnessSignal } from '../../domain/types.js'

const endpoints = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./launcher.js', () => ({
  readCodexEndpoint: (_dir: string, id: string) => endpoints.get(id) ?? null,
}))
const sockets = vi.hoisted(() => [] as FakeSocket[])
interface FakeSocket extends EventEmitter {
  readyState: number
  sent: { id?: number; method: string; params?: unknown }[]
  send(value: string): void
  terminate(): void
  message(value: unknown): void
}
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    default: class extends EventEmitter implements FakeSocket {
      static CLOSING = 2
      readyState = 0
      sent: { id?: number; method: string; params?: unknown }[] = []
      constructor() {
        super()
        sockets.push(this)
      }
      send(value: string) {
        this.sent.push(JSON.parse(value) as (typeof this.sent)[number])
      }
      terminate() {
        this.readyState = 3
        this.emit('close')
      }
      message(value: unknown) {
        this.emit('message', Buffer.from(JSON.stringify(value)))
      }
    },
  }
})
const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  endpoints.clear()
  sockets.length = 0
})
function fixture(afterRebind?: () => void) {
  let bindings: NativeBinding[] = [
    {
      id: 'garden',
      codexId: 'native-a',
      cwd: '/repo',
      transcriptPath: '/rollout',
      generation: 0,
      backendGeneration: 'one',
    },
  ]
  endpoints.set('garden', {
    version: 1,
    generation: 'one',
    endpoint: 'unix:///tmp/native.sock',
    pid: 1,
  })
  const signals: HarnessSignal[] = []
  const titles: (string | null)[] = []
  const rebindPath = vi.fn((binding: NativeBinding, path: string) => {
    const replacement = { ...binding, transcriptPath: path, generation: binding.generation + 1 }
    bindings = [replacement]
    afterRebind?.()
    return replacement
  })
  const observer = observeNativeStatus({
    rebind: rebindPath,
    appDir: '/app',
    bindings: () => bindings,
    onSignal: (signal) => signals.push(signal),
    onTitle: (_binding, title) => titles.push(title),
  })
  stops.push(() => observer.close())
  const connect = () => {
    const socket = sockets.at(-1)!
    socket.readyState = 1
    socket.emit('open')
    socket.message({ id: 1, result: {} })
    return socket
  }
  const status = () => signals.findLast((signal) => signal.reported !== undefined)?.reported?.status
  return {
    observer,
    signals,
    titles,
    connect,
    status,
    rebindPath,
    rebind: () => {
      bindings = [{ ...bindings[0]!, codexId: 'native-b', generation: 1 }]
    },
  }
}
const active = { type: 'active', activeFlags: ['waitingOnApproval'] }
function notification(socket: FakeSocket, status: unknown, threadId = 'native-a') {
  socket.message({ method: 'thread/status/changed', params: { threadId, status } })
}
function snapshot(
  socket: FakeSocket,
  status: unknown,
  name?: unknown,
  path?: string,
  id = 'native-a',
) {
  socket.message({ id: 2, result: { thread: { id, status, name, path } } })
}
function revert(socket: FakeSocket, threadId = 'native-a') {
  socket.message({ method: 'thread/reverted', params: { threadId, numTurns: 1 } })
}
function rename(socket: FakeSocket, threadName: unknown, threadId = 'native-a') {
  socket.message({ method: 'thread/name/updated', params: { threadId, threadName } })
}
describe('native status observer', () => {
  it('hydrates the title when a newer status notification wins over the status snapshot', () => {
    const f = fixture()
    const socket = f.connect()
    notification(socket, active)
    snapshot(socket, { type: 'idle' }, '  Review payments 📊  ')
    expect(f.status()).toBe('needs-approval')
    expect(f.titles).toEqual(['  Review payments 📊  '])
  })
  it('keeps a newer title notification and still hydrates status', () => {
    const f = fixture()
    const socket = f.connect()
    const signalCount = f.signals.length
    rename(socket, 'Manual rename')
    expect(f.signals).toHaveLength(signalCount)
    snapshot(socket, active, 'Older name')
    expect(f.status()).toBe('needs-approval')
    expect(f.titles).toEqual(['Manual rename'])
  })
  it('recognizes an unnamed thread without clearing the title on failed reads or disconnects', () => {
    const f = fixture()
    const socket = f.connect()
    snapshot(socket, { type: 'idle' })
    rename(socket, 'New name')
    socket.terminate()
    f.observer.refresh()
    const second = f.connect()
    second.message({ id: 2, error: { message: 'unavailable' } })
    expect(f.titles).toEqual([null, 'New name'])
  })
  it('ignores names from unrelated threads, stale bindings and server requests', () => {
    const f = fixture()
    const first = f.connect()
    rename(first, 'Subagent', 'native-b')
    rename(first, 123)
    first.message({
      id: 99,
      method: 'thread/name/updated',
      params: { threadId: 'native-a', threadName: 'Request' },
    })
    f.rebind()
    rename(first, 'Retired binding')
    f.observer.refresh()
    const second = f.connect()
    rename(second, 'Current binding', 'native-b')
    endpoints.clear()
    rename(second, 'Retired endpoint', 'native-b')
    expect(f.titles).toEqual(['Current binding'])
  })
  it('recovers pending approvals from a snapshot and follows native resolution only', () => {
    const f = fixture()
    const socket = f.connect()
    snapshot(socket, active)
    expect(f.status()).toBe('needs-approval')
    socket.message({ id: 99, method: 'item/commandExecution/requestApproval', params: {} })
    expect(socket.sent.map((m) => m.method)).toEqual(['initialize', 'initialized', 'thread/read'])
    notification(socket, { type: 'active', activeFlags: [] })
    expect(f.status()).toBe('working')
    notification(socket, { type: 'idle' })
    expect(f.status()).toBe('waiting')
    notification(socket, active, 'subagent')
    expect(f.status()).toBe('waiting')
  })
  it('does not let an older snapshot overwrite a notification during its read', () => {
    const f = fixture()
    const socket = f.connect()
    notification(socket, active)
    snapshot(socket, { type: 'idle' })
    expect(f.status()).toBe('needs-approval')
  })
  it('reports unknown on connection loss and snapshots again after reconnect', () => {
    const f = fixture()
    const socket = f.connect()
    snapshot(socket, active)
    socket.terminate()
    expect(f.status()).toBe('unknown')
    f.observer.refresh()
    const second = f.connect()
    snapshot(second, active)
    expect(f.status()).toBe('needs-approval')
  })
  it('reconnects on a matching revert and uses the replacement snapshot without accepting buffered old events', () => {
    const f = fixture()
    const first = f.connect()
    revert(first, 'subagent')
    expect(sockets).toHaveLength(1)
    revert(first)
    expect(first.readyState).toBeGreaterThanOrEqual(2)
    expect(sockets).toHaveLength(2)
    snapshot(first, active, 'Removed title', '/removed.jsonl')
    revert(first)
    expect(sockets).toHaveLength(2)
    expect(f.rebindPath).not.toHaveBeenCalled()
    expect(f.titles).toEqual([])

    const second = f.connect()
    expect(second.sent.at(-1)).toMatchObject({
      method: 'thread/read',
      params: { threadId: 'native-a' },
    })
    notification(second, active)
    rename(second, 'Latest title')
    snapshot(second, { type: 'idle' }, 'Older title', '/retained.jsonl')
    expect(f.rebindPath).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ codexId: 'native-a', transcriptPath: '/rollout' }),
      '/retained.jsonl',
      true,
    )
    expect(f.signals.filter((signal) => signal.resetConversation)).toEqual([
      expect.objectContaining({
        sessionId: 'garden',
        transcriptPath: '/retained.jsonl',
        ended: null,
        conversationCleared: false,
      }),
    ])
    expect(f.titles).toEqual(['Latest title'])
    expect(f.status()).toBe('needs-approval')
    notification(second, { type: 'idle' })
    expect(f.signals.at(-1)).toMatchObject({
      transcriptPath: '/retained.jsonl',
      reported: { status: 'waiting' },
    })
    f.observer.refresh()
    expect(sockets).toHaveLength(2)
  })
  it('reconciles a replacement on ordinary reconnect after a missed revert', () => {
    const f = fixture()
    const first = f.connect()
    snapshot(first, { type: 'idle' }, 'Original', '/rollout')
    expect(f.rebindPath).not.toHaveBeenCalled()
    first.terminate()
    f.observer.refresh()
    const second = f.connect()
    snapshot(second, active, 'Retained', '/retained.jsonl')
    expect(f.rebindPath).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ codexId: 'native-a', transcriptPath: '/rollout' }),
      '/retained.jsonl',
      false,
    )
    expect(f.signals.at(-1)).toMatchObject({
      transcriptPath: '/retained.jsonl',
      reported: { status: 'needs-approval' },
    })
    expect(f.titles).toEqual(['Original', 'Retained'])
  })
  it('publishes the persisted replacement without stale status or title if its endpoint disappears', () => {
    const f = fixture(() => {
      endpoints.delete('garden')
    })
    snapshot(f.connect(), active, 'Closed backend title', '/retained.jsonl')
    expect(f.signals.at(-1)).toEqual({
      sessionId: 'garden',
      cwd: '/repo',
      transcriptPath: '/retained.jsonl',
      resetConversation: true,
      ended: null,
      conversationCleared: false,
    })
    expect(f.status()).toBe('unknown')
    expect(f.titles).toEqual([])
  })
  it('ignores a replacement snapshot returned for an unrelated thread', () => {
    const f = fixture()
    snapshot(f.connect(), active, 'Foreign title', '/foreign.jsonl', 'subagent')
    expect(f.rebindPath).not.toHaveBeenCalled()
    expect(f.status()).toBe('unknown')
    expect(f.titles).toEqual([])
  })
  it('rejects stale alias generations and descriptor replacement before the next poll', () => {
    const f = fixture()
    const first = f.connect()
    snapshot(first, { type: 'idle' })
    f.rebind()
    notification(first, active)
    expect(f.status()).toBe('waiting')
    f.observer.refresh()
    const second = f.connect()
    notification(second, active, 'native-b')
    expect(f.status()).toBe('needs-approval')
    endpoints.set('garden', {
      version: 1,
      generation: 'two',
      endpoint: 'unix:///tmp/new.sock',
      pid: 1,
    })
    notification(second, { type: 'idle' }, 'native-b')
    expect(f.status()).toBe('needs-approval')
    f.observer.refresh()
    expect(f.status()).toBe('unknown')
  })
  it('keeps old embedded bindings unknown without an endpoint and never connects', () => {
    const f = fixture()
    f.observer.close()
    sockets.length = 0
    endpoints.clear()
    const observer = observeNativeStatus({
      appDir: '/app',
      bindings: () => [
        {
          id: 'garden',
          codexId: 'native',
          cwd: '/repo',
          transcriptPath: '/rollout',
          generation: 0,
          backendGeneration: 'one',
        },
      ],
      onSignal: (s) => f.signals.push(s),
    })
    stops.push(() => observer.close())
    expect(f.status()).toBe('unknown')
    expect(sockets).toHaveLength(0)
  })
  it('waits for the TUI binding from the current backend generation before connecting', () => {
    const f = fixture()
    f.observer.close()
    sockets.length = 0
    let generation = 'previous'
    const observer = observeNativeStatus({
      appDir: '/app',
      bindings: () => [
        {
          id: 'garden',
          codexId: 'native-a',
          cwd: '/repo',
          transcriptPath: '/rollout',
          generation: 0,
          backendGeneration: generation,
        },
      ],
      onSignal: (s) => f.signals.push(s),
    })
    stops.push(() => observer.close())
    expect(sockets).toHaveLength(0)
    expect(f.status()).toBe('unknown')
    generation = 'one'
    observer.refresh()
    expect(sockets).toHaveLength(1)
  })
  it('maps unfamiliar or unloaded native status to unknown', () => {
    expect(nativeStatus({ type: 'notLoaded' }).status).toBe('unknown')
    expect(nativeStatus({ type: 'active', activeFlags: ['waitingOnUserInput'] }).status).toBe(
      'working',
    )
  })
})
