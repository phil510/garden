import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface IndexedTitle {
  title: string | null;
  row: string;
}

export function createSessionIndex(codexHome: string) {
  const path = join(codexHome, 'session_index.jsonl');
  let signature: string | undefined;
  let titles = new Map<string, IndexedTitle>();

  async function fileSignature(): Promise<string> {
    const { dev, ino, size, mtimeNs, ctimeNs } = await stat(path, { bigint: true });
    return [dev, ino, size, mtimeNs, ctimeNs].join(':');
  }

  return async (): Promise<ReadonlyMap<string, IndexedTitle>> => {
    try {
      const observed = await fileSignature();
      if (observed === signature) return titles;
      const contents = await readFile(path, 'utf8');
      if ((await fileSignature()) !== observed) return titles;

      const next = new Map<string, IndexedTitle>();
      for (const row of contents.split('\n')) {
        if (row.trim() === '') continue;
        try {
          const entry = JSON.parse(row) as {
            id?: unknown;
            thread_name?: unknown;
            updated_at?: unknown;
          } | null;
          if (
            typeof entry?.id === 'string' &&
            typeof entry.thread_name === 'string' &&
            typeof entry.updated_at === 'string'
          )
            next.set(entry.id, {
              title: entry.thread_name.trim() === '' ? null : entry.thread_name,
              row,
            });
        } catch {
          // A malformed line leaves the previous valid entry for its thread in place.
        }
      }
      titles = next;
      signature = observed;
    } catch {
      // A missing or unreadable file can be temporary. Retry without replacing the last read.
    }
    return titles;
  };
}
