import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readClaudeSessionNames } from './claudeSessions.js';

function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'garden-claude-sessions-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('readClaudeSessionNames', () => {
  it('resolves to an empty map when the registry directory does not exist', async () => {
    await withTempDir(async (dir) => {
      expect(await readClaudeSessionNames(join(dir, 'missing'))).toEqual({});
    });
  });

  it('reads a session id to name entry from a valid registry file', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(
        join(dir, '1234.json'),
        JSON.stringify({ pid: 1234, sessionId: 'sid-1', name: 'garden-7a' }),
      );
      expect(await readClaudeSessionNames(dir)).toEqual({ 'sid-1': 'garden-7a' });
    });
  });

  it('skips a malformed registry file and still resolves the valid ones', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, '1234.json'), '{not json');
      writeFileSync(
        join(dir, '5678.json'),
        JSON.stringify({ pid: 5678, sessionId: 'sid-2', name: 'garden-9c' }),
      );
      expect(await readClaudeSessionNames(dir)).toEqual({ 'sid-2': 'garden-9c' });
    });
  });
});
