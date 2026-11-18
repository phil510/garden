import { describe, expect, it, vi } from 'vitest'
import { aHarnessSignal } from '../domain/signals.fixture.js'
import { handleHook } from './hooks.js'
import type { Projection } from './projection.js'

it('hands the raw body and garden identity to the harness before tracking and dispatching its signal', () => {
  const signal = aHarnessSignal({
    sessionId: 'garden-key',
    transcriptPath: '/native/conversation',
  })
  const calls: unknown[] = []
  const body = { vendor: 'opaque payload' }
  const deps = {
    harness: {
      parseHook: vi.fn(() => {
        calls.push('parse')
        return signal
      }),
    },
    liveTranscripts: { track: (path: string) => calls.push(path) },
    projection: { dispatch: (event: unknown) => calls.push(event) } as unknown as Projection,
  }
  expect(handleHook(deps, body, 'garden-key')).toBe(true)
  expect(deps.harness.parseHook).toHaveBeenCalledWith(body, 'garden-key')
  expect(calls).toEqual(['parse', '/native/conversation', { type: 'harness-signal', signal }])
})

describe('rejected harness input', () => {
  it('does not track or dispatch', () => {
    const track = vi.fn()
    const dispatch = vi.fn()
    expect(
      handleHook(
        {
          harness: { parseHook: () => null },
          liveTranscripts: { track },
          projection: { dispatch } as unknown as Projection,
        },
        {},
        undefined,
      ),
    ).toBe(false)
    expect(track).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})
