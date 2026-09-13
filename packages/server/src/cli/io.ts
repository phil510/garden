/** The minimal shape `writeAll` needs. Matches the callback overload of
 *  `NodeJS.WritableStream.write`, so `process.stdout`/`process.stderr` satisfy it as-is. */
export interface WritableLike {
  write(text: string, callback?: (err?: Error | null) => void): void;
}

/** Resolves only once `text` has actually been delivered. The callback form reports
 *  completion for both an immediate write and a backpressured one, so there is no need to
 *  separately watch for `'drain'` — awaiting this is what makes it safe to `process.exit()`
 *  right after. */
export function writeAll(stream: WritableLike, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
