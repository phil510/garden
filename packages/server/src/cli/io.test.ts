import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { writeAll } from './io.js';

/** A real Writable with genuine backpressure: `_write` holds its callback until the test
 *  calls `release`, and `highWaterMark` is low enough that a normal-sized chunk stays
 *  buffered (not a TTY-like fake that completes synchronously). */
function backpressuredWritable(): {
  stream: Writable;
  release: () => void;
  delivered: string[];
} {
  const delivered: string[] = [];
  let pending: (() => void) | null = null;
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk: Buffer, _encoding, callback) {
      pending = () => {
        delivered.push(chunk.toString());
        callback();
      };
    },
  });
  return {
    stream,
    delivered,
    release: () => {
      pending?.();
      pending = null;
    },
  };
}

describe('writeAll', () => {
  it('does not resolve until a backpressured write is actually delivered', async () => {
    const { stream, release, delivered } = backpressuredWritable();
    let resolved = false;

    const promise = writeAll(stream, 'x'.repeat(100)).then(() => {
      resolved = true;
    });

    // The chunk is still sitting in the stream's internal buffer here — proof the code under
    // test could not yet safely call process.exit() without truncating it.
    expect(stream.writableLength).toBeGreaterThan(0);
    expect(resolved).toBe(false);
    expect(delivered).toEqual([]);

    release();
    await promise;

    expect(resolved).toBe(true);
    expect(delivered).toEqual(['x'.repeat(100)]);
  });

  it('rejects when the stream reports a write error', async () => {
    const stream = {
      write: (_text: string, callback?: (err?: Error | null) => void) => {
        callback?.(new Error('EPIPE'));
      },
    };

    await expect(writeAll(stream, 'x')).rejects.toThrow('EPIPE');
  });
});
