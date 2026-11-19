import { describe, expect, it } from 'vitest'
import type { GardenEvent, TranscriptRecord } from '../domain/types.js'
import type { TranscriptPort } from './ports.js'
import { createTranscriptReplay } from './transcriptReplay.js'

const record = (sessionId: string, title: string): TranscriptRecord => ({
  sessionId,
  cwd: '/Users/dev/repo',
  title,
  lastPrompt: null,
  recap: null,
  lastActivity: 1,
})

const liveEvent = (title: string): Extract<GardenEvent, { type: 'transcript-changed' }> => ({
  type: 'transcript-changed',
  path: '/a.jsonl',
  record: record('sid-a', title),
})

const silent = { warn: () => undefined, error: () => undefined }

function setup(
  files: Record<string, () => Promise<TranscriptRecord>>,
  logger: { warn(m: string): void; error(m: string): void } = silent,
) {
  const dispatched: GardenEvent[] = []
  const transcripts = {
    listFiles: () => Promise.resolve(Object.keys(files)),
    readRecord: async (path: string) => ({ record: await files[path]!(), skipped: 0 }),
  } as unknown as TranscriptPort
  const replay = createTranscriptReplay(
    { projection: { dispatch: (event) => void dispatched.push(event) }, transcripts },
    logger,
  )
  return { replay, dispatched }
}

describe('transcript replay', () => {
  it('dispatches one batch in listing order even when reads finish out of order', async () => {
    const slow = new Promise<TranscriptRecord>((resolve) =>
      setTimeout(() => {
        resolve(record('sid-a', 'first'))
      }, 20),
    )
    const { replay, dispatched } = setup({
      '/a.jsonl': () => slow,
      '/b.jsonl': () => Promise.resolve(record('sid-b', 'second')),
    })
    await replay.run()
    expect(dispatched).toEqual([
      {
        type: 'transcripts-replayed',
        records: [record('sid-a', 'first'), record('sid-b', 'second')],
      },
    ])
  })

  it('keeps the other records when one read throws, and logs it', async () => {
    const errors: string[] = []
    const { replay, dispatched } = setup(
      {
        '/a.jsonl': () => Promise.reject(new Error('EACCES')),
        '/b.jsonl': () => Promise.resolve(record('sid-b', 'second')),
      },
      { warn: () => undefined, error: (m) => void errors.push(m) },
    )
    await replay.run()
    expect(dispatched).toEqual([
      { type: 'transcripts-replayed', records: [record('sid-b', 'second')] },
    ])
    expect(errors).toEqual(['failed to read transcript /a.jsonl: EACCES'])
  })

  it('holds a live event that arrives mid-replay until the batch has landed', async () => {
    let release: (value: TranscriptRecord) => void = () => undefined
    const { replay, dispatched } = setup({
      '/a.jsonl': () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    const running = replay.run()
    replay.live(liveEvent('newer'))
    expect(dispatched).toEqual([])
    // Let the listing resolve so the read is in flight and `release` is armed.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dispatched).toEqual([])
    release(record('sid-a', 'older'))
    await running
    expect(dispatched.map((event) => event.type)).toEqual([
      'transcripts-replayed',
      'transcript-changed',
    ])
  })

  it('dispatches live events directly once the replay has landed', async () => {
    const { replay, dispatched } = setup({})
    await replay.run()
    replay.live(liveEvent('later'))
    expect(dispatched.at(-1)).toEqual(liveEvent('later'))
  })
})

describe('invalidated transcript reads', () => {
  it('omits an invalidated read from the boot batch', async () => {
    const dispatched: GardenEvent[] = []
    const transcripts: TranscriptPort = {
      listFiles: () => Promise.resolve(['/old']),
      readRecord: () => Promise.resolve(null),
      watch: () => ({ track: () => undefined, close: () => Promise.resolve() }),
    }
    await createTranscriptReplay(
      {
        projection: {
          dispatch: (event) => {
            dispatched.push(event)
          },
        },
        transcripts,
      },
      silent,
    ).run()
    expect(dispatched).toEqual([{ type: 'transcripts-replayed', records: [] }])
  })
})

it('drops a completed old read and held live event if clear happens while another boot read is pending', async () => {
  const dispatched: GardenEvent[] = []
  let current = true
  let entered: (() => void) | undefined
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    entered = resolve
  })
  const oldRecord = record('sid-a', 'old')
  const transcripts: TranscriptPort = {
    listFiles: () => Promise.resolve(['/a.jsonl', '/slow']),
    readRecord: async (path) => {
      if (path === '/a.jsonl') return { record: oldRecord, skipped: 0 }
      entered!()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { record: record('sid-b', 'other'), skipped: 0 }
    },
    isCurrent: (_path, candidate) => candidate.sessionId !== 'sid-a' || current,
    watch: () => ({ track: () => undefined, close: () => Promise.resolve() }),
  }
  const replay = createTranscriptReplay(
    {
      projection: {
        dispatch: (event) => {
          dispatched.push(event)
        },
      },
      transcripts,
    },
    silent,
  )
  const running = replay.run()
  await pending
  replay.live({ type: 'transcript-changed', path: '/a.jsonl', record: oldRecord })
  current = false
  release!()
  await running
  expect(dispatched).toEqual([
    { type: 'transcripts-replayed', records: [record('sid-b', 'other')] },
  ])
})
