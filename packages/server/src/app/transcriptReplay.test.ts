import { describe, expect, it } from 'vitest';
import type { GardenEvent, TranscriptRecord } from '../domain/types.js';
import type { TranscriptPort } from './ports.js';
import { createTranscriptReplay } from './transcriptReplay.js';

const record = (sessionId: string, title: string): TranscriptRecord => ({
  sessionId,
  cwd: '/Users/dev/repo',
  title,
  lastPrompt: null,
  recap: null,
  lastActivity: 1,
});

const liveEvent = (title: string): Extract<GardenEvent, { type: 'transcript-changed' }> => ({
  type: 'transcript-changed',
  path: '/a.jsonl',
  record: record('sid-a', title),
});

const silent = { warn: () => undefined, error: () => undefined };

function setup(
  files: Record<string, () => Promise<TranscriptRecord>>,
  logger: { warn(m: string): void; error(m: string): void } = silent,
) {
  const dispatched: GardenEvent[] = [];
  const transcripts = {
    listFiles: () => Promise.resolve(Object.keys(files)),
    readRecord: async (path: string) => ({ record: await files[path]!(), skipped: 0 }),
  } as unknown as TranscriptPort;
  const replay = createTranscriptReplay(
    { projection: { dispatch: (event) => void dispatched.push(event) }, transcripts },
    logger,
  );
  return { replay, dispatched };
}

describe('transcript replay', () => {
  it('dispatches one batch in listing order even when reads finish out of order', async () => {
    const slow = new Promise<TranscriptRecord>((resolve) =>
      setTimeout(() => {
        resolve(record('sid-a', 'first'));
      }, 20),
    );
    const { replay, dispatched } = setup({
      '/a.jsonl': () => slow,
      '/b.jsonl': () => Promise.resolve(record('sid-b', 'second')),
    });
    await replay.run();
    expect(dispatched).toEqual([
      {
        type: 'transcripts-replayed',
        records: [record('sid-a', 'first'), record('sid-b', 'second')],
      },
    ]);
  });

  it('keeps the other records when one read throws, and logs it', async () => {
    const errors: string[] = [];
    const { replay, dispatched } = setup(
      {
        '/a.jsonl': () => Promise.reject(new Error('EACCES')),
        '/b.jsonl': () => Promise.resolve(record('sid-b', 'second')),
      },
      { warn: () => undefined, error: (m) => void errors.push(m) },
    );
    await replay.run();
    expect(dispatched).toEqual([
      { type: 'transcripts-replayed', records: [record('sid-b', 'second')] },
    ]);
    expect(errors).toEqual(['failed to read transcript /a.jsonl: EACCES']);
  });

  it('holds a live event that arrives mid-replay until the batch has landed', async () => {
    let release: (value: TranscriptRecord) => void = () => undefined;
    const { replay, dispatched } = setup({
      '/a.jsonl': () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const running = replay.run();
    replay.live(liveEvent('newer'));
    expect(dispatched).toEqual([]);
    // Let the listing resolve so the read is in flight and `release` is armed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispatched).toEqual([]);
    release(record('sid-a', 'older'));
    await running;
    expect(dispatched.map((event) => event.type)).toEqual([
      'transcripts-replayed',
      'transcript-changed',
    ]);
  });

  it('dispatches live events directly once the replay has landed', async () => {
    const { replay, dispatched } = setup({});
    await replay.run();
    replay.live(liveEvent('later'));
    expect(dispatched.at(-1)).toEqual(liveEvent('later'));
  });
});
