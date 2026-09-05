import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { slugify } from '../domain/slug.js';
import { listTranscriptFiles, readTranscriptRecord } from './transcripts.js';

function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'garden-transcripts-'));
  return fn(home).finally(() => rmSync(home, { recursive: true, force: true }));
}

function writeProjectFile(home: string, root: string, sessionId: string, text: string): void {
  const dir = join(home, '.claude', 'projects', slugify(root));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), text, 'utf8');
}

describe('listTranscriptFiles', () => {
  it('returns an empty list when the projects directory does not exist', async () => {
    await withTempHome(async (home) => {
      expect(await listTranscriptFiles(home, ['/Users/phil/Desktop/Extend'])).toEqual([]);
    });
  });

  it('lists jsonl files under an in-scope project directory and skips out-of-scope ones', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      writeProjectFile(home, root, 'session-a', '{}\n');
      writeProjectFile(home, '/Users/phil/Downloads/scratch', 'session-b', '{}\n');

      const files = await listTranscriptFiles(home, ['/Users/phil/Desktop/Extend']);
      expect(files).toEqual([join(home, '.claude', 'projects', slugify(root), 'session-a.jsonl')]);
    });
  });

  it('ignores non-jsonl entries and subdirectories within a project directory', async () => {
    await withTempHome(async (home) => {
      const root = '/Users/phil/Desktop/Extend/garden';
      writeProjectFile(home, root, 'session-a', '{}\n');
      const dir = join(home, '.claude', 'projects', slugify(root));
      writeFileSync(join(dir, 'notes.txt'), 'not a transcript', 'utf8');
      mkdirSync(join(dir, 'subagents'), { recursive: true });
      writeFileSync(join(dir, 'subagents', 'child.jsonl'), '{}\n', 'utf8');

      const files = await listTranscriptFiles(home, ['/Users/phil/Desktop/Extend']);
      expect(files).toEqual([join(dir, 'session-a.jsonl')]);
    });
  });
});

const HEAD_LINE = (sessionId: string) =>
  JSON.stringify({
    type: 'user',
    sessionId,
    cwd: '/Users/phil/Desktop/Extend/garden',
    gitBranch: 'main',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { content: 'hello' },
  });

const TITLE_LINE = JSON.stringify({ type: 'ai-title', aiTitle: 'Bounded read title' });
const LAST_PROMPT_LINE = JSON.stringify({ type: 'last-prompt', lastPrompt: 'do the thing' });

describe('readTranscriptRecord', () => {
  it('parses a file smaller than the window in one read', async () => {
    await withTempHome(async (home) => {
      const path = join(home, 'small.jsonl');
      writeFileSync(path, [HEAD_LINE('session-a'), TITLE_LINE].join('\n') + '\n', 'utf8');

      const { record } = await readTranscriptRecord(path);
      expect(record.sessionId).toBe('session-a');
      expect(record.title).toBe('Bounded read title');
    });
  });

  it('finds the session identity in the head and the title in the tail of a file bigger than the window', async () => {
    await withTempHome(async (home) => {
      const path = join(home, 'large.jsonl');
      const fillerLine = JSON.stringify({
        type: 'assistant',
        message: { content: 'x'.repeat(5000) },
      });
      const text =
        [HEAD_LINE('session-b'), fillerLine, TITLE_LINE, LAST_PROMPT_LINE].join('\n') + '\n';
      writeFileSync(path, text, 'utf8');

      const { record } = await readTranscriptRecord(path, 300);
      expect(record.sessionId).toBe('session-b');
      expect(record.cwd).toBe('/Users/phil/Desktop/Extend/garden');
      expect(record.title).toBe('Bounded read title');
      expect(record.lastPrompt).toBe('do the thing');
    });
  });

  it('drops a single line that exceeds both windows without throwing', async () => {
    await withTempHome(async (home) => {
      const path = join(home, 'huge-line.jsonl');
      writeFileSync(path, JSON.stringify({ type: 'user', content: 'x'.repeat(300) }), 'utf8');

      const { record, skipped } = await readTranscriptRecord(path, 50);
      expect(record).toEqual({
        sessionId: null,
        cwd: null,
        gitBranch: null,
        title: null,
        lastPrompt: null,
        recap: null,
        lastActivity: null,
      });
      expect(skipped).toBe(0);
    });
  });
});
