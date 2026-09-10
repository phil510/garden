import { describe, expect, it } from 'vitest';
import { parseTranscript } from './transcript.js';

const line = (o: unknown) => JSON.stringify(o);
const envelope = { cwd: '/Users/dev/repo', gitBranch: 'feat/x', sessionId: 'sid-1' };
const assistant = (blocks: unknown[]) => ({
  ...envelope,
  type: 'assistant',
  message: { content: blocks },
});

describe('parseTranscript', () => {
  it('takes the title from the last ai-title line, not the first', () => {
    const text = [
      line({ type: 'ai-title', aiTitle: 'Early guess' }),
      line({ ...envelope, type: 'user', message: { content: 'hi' } }),
      line({ type: 'ai-title', aiTitle: 'Settled title' }),
    ].join('\n');
    expect(parseTranscript(text).record.title).toBe('Settled title');
  });

  it('falls back to a summary line for transcripts written before ai-title existed', () => {
    const text = line({ type: 'summary', summary: 'Older transcript' });
    expect(parseTranscript(text).record.title).toBe('Older transcript');
  });

  it('prefers an ai-title line over a summary line when the transcript carries both', () => {
    const text = [
      line({ type: 'summary', summary: 'Older transcript' }),
      line({ type: 'ai-title', aiTitle: 'Settled title' }),
    ].join('\n');
    expect(parseTranscript(text).record.title).toBe('Settled title');
  });

  it('takes the last text block within one content array, not the first', () => {
    const text = line(
      assistant([
        { type: 'text', text: 'thinking out loud' },
        { type: 'tool_use', name: 'Bash', input: {} },
        { type: 'text', text: 'the conclusion' },
      ]),
    );
    expect(parseTranscript(text).record.recap).toBe('the conclusion');
  });

  it('reads sessionId from the first conversation-bearing line', () => {
    const text = [
      line({ ...envelope, sessionId: 'sid-1', type: 'user', message: { content: 'hi' } }),
      line({ ...envelope, sessionId: 'sid-2', type: 'user', message: { content: 'later' } }),
    ].join('\n');
    expect(parseTranscript(text).record.sessionId).toBe('sid-1');
  });

  it('reads cwd and gitBranch from the last conversation-bearing line, not the first', () => {
    const text = [
      line({ ...envelope, gitBranch: 'main', type: 'user', message: { content: 'hi' } }),
      line({
        ...envelope,
        cwd: '/Users/dev/repo/.worktrees/feat-x',
        gitBranch: 'feat/x',
        type: 'user',
        message: { content: 'moved into a worktree' },
      }),
    ].join('\n');
    expect(parseTranscript(text).record).toMatchObject({
      cwd: '/Users/dev/repo/.worktrees/feat-x',
      gitBranch: 'feat/x',
    });
  });

  it('reads gitBranch as null rather than inherited when the last line has cwd but no branch', () => {
    const text = [
      line({ ...envelope, type: 'user', message: { content: 'hi' } }),
      line({
        ...envelope,
        cwd: '/tmp/scratch',
        gitBranch: null,
        type: 'user',
        message: { content: 'cd into a non-git directory' },
      }),
    ].join('\n');
    expect(parseTranscript(text).record).toMatchObject({
      cwd: '/tmp/scratch',
      gitBranch: null,
    });
  });

  it('skips a trailing line with neither cwd nor gitBranch to reach an earlier line that has them', () => {
    const text = [
      line({ ...envelope, type: 'user', message: { content: 'hi' } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'no cwd here' }] } }),
    ].join('\n');
    expect(parseTranscript(text).record).toMatchObject({
      cwd: envelope.cwd,
      gitBranch: envelope.gitBranch,
    });
  });

  it('skips back past thinking and tool_use blocks to the last assistant text block', () => {
    const text = [
      assistant([{ type: 'text', text: 'the recap' }]),
      assistant([{ type: 'thinking', thinking: 'hmm' }]),
      assistant([{ type: 'tool_use', name: 'Bash', input: {} }]),
    ]
      .map(line)
      .join('\n');
    expect(parseTranscript(text).record.recap).toBe('the recap');
  });

  it('leaves the recap null when no assistant line carries a text block', () => {
    const text = [assistant([{ type: 'thinking', thinking: 'hmm' }])].map(line).join('\n');
    expect(parseTranscript(text).record.recap).toBeNull();
  });

  it('reads a user message whose content is a bare string', () => {
    const text = line({ ...envelope, type: 'user', message: { content: 'plain string' } });
    expect(parseTranscript(text).record.lastPrompt).toBe('plain string');
  });

  it('reads a user message whose content is an array of blocks', () => {
    const text = line({
      ...envelope,
      type: 'user',
      message: { content: [{ type: 'text', text: 'array block' }] },
    });
    expect(parseTranscript(text).record.lastPrompt).toBe('array block');
  });

  it('prefers an explicit last-prompt line over the last user message', () => {
    const text = [
      line({ ...envelope, type: 'user', message: { content: 'typed by hand' } }),
      line({ type: 'last-prompt', lastPrompt: 'pre-truncated…' }),
    ].join('\n');
    expect(parseTranscript(text).record.lastPrompt).toBe('pre-truncated…');
  });

  it('reads sessionId and ignores the duplicate snake_case session_id', () => {
    const text = line({
      ...envelope,
      session_id: 'wrong',
      type: 'user',
      message: { content: 'hi' },
    });
    expect(parseTranscript(text).record.sessionId).toBe('sid-1');
  });

  it('ignores unknown line types instead of counting them as unparseable', () => {
    const text = [
      line({ type: 'file-history-snapshot', snapshot: {} }),
      line({ type: 'queue-operation' }),
    ].join('\n');
    expect(parseTranscript(text)).toEqual({
      record: {
        sessionId: null,
        cwd: null,
        gitBranch: null,
        title: null,
        lastPrompt: null,
        recap: null,
        lastActivity: null,
      },
      skipped: 0,
    });
  });

  it('counts truncated head and tail lines and still reads the whole lines between them', () => {
    const text = [
      '{"type":"assistant","messa',
      line({ type: 'ai-title', aiTitle: 'Survived' }),
      '{"type":"ai-title","aiTit',
    ].join('\n');
    const { record, skipped } = parseTranscript(text);
    expect(record.title).toBe('Survived');
    expect(skipped).toBe(2);
  });

  it('falls back to the first real prompt, skipping a slash-command wrapper line', () => {
    const text = [
      line({ ...envelope, type: 'user', message: { content: '<command-name>compact' } }),
      line({ ...envelope, type: 'user', message: { content: 'the real question' } }),
      line({ ...envelope, type: 'user', message: { content: 'a later follow-up' } }),
    ].join('\n');
    expect(parseTranscript(text).record.lastPrompt).toBe('the real question');
  });

  it('skips an isMeta caveat line when falling back to the first prompt', () => {
    const text = [
      line({ ...envelope, type: 'user', isMeta: true, message: { content: 'Caveat: the user…' } }),
      line({ ...envelope, type: 'user', message: { content: 'the real question' } }),
      line({ ...envelope, type: 'user', message: { content: 'a later follow-up' } }),
    ].join('\n');
    expect(parseTranscript(text).record.lastPrompt).toBe('the real question');
  });

  it('takes the last assistant text as the recap when it follows the away_summary', () => {
    const text = [
      { type: 'system', subtype: 'away_summary', content: 'While you were away…' },
      assistant([{ type: 'text', text: 'back to work' }]),
    ]
      .map(line)
      .join('\n');
    expect(parseTranscript(text).record.recap).toBe('back to work');
  });

  it('takes an away_summary as the recap when it follows the last assistant text', () => {
    const text = [
      assistant([{ type: 'text', text: 'the last assistant text' }]),
      { type: 'system', subtype: 'away_summary', content: 'While you were away…' },
    ]
      .map(line)
      .join('\n');
    expect(parseTranscript(text).record.recap).toBe('While you were away…');
  });

  it('falls back to the last assistant text when no away_summary line exists', () => {
    const text = [
      assistant([{ type: 'text', text: 'the last assistant text' }]),
      { type: 'system', subtype: 'other', content: 'not a recap' },
    ]
      .map(line)
      .join('\n');
    expect(parseTranscript(text).record.recap).toBe('the last assistant text');
  });

  it('takes last activity from the last timestamped line, past untimestamped sidecar lines', () => {
    const text = [
      line({
        ...envelope,
        type: 'user',
        timestamp: '2026-09-01T10:00:00.000Z',
        message: { content: 'hi' },
      }),
      line({
        ...envelope,
        type: 'assistant',
        timestamp: '2026-09-01T11:30:00.000Z',
        message: { content: [] },
      }),
      line({ type: 'ai-title', aiTitle: 'Settled title' }),
      line({ type: 'last-prompt', lastPrompt: 'hi' }),
    ].join('\n');
    expect(parseTranscript(text).record.lastActivity).toBe(Date.parse('2026-09-01T11:30:00.000Z'));
  });

  it('reports no last activity when no line carries a timestamp', () => {
    const text = line({ ...envelope, type: 'user', message: { content: 'hi' } });
    expect(parseTranscript(text).record.lastActivity).toBeNull();
  });

  it('ignores a timestamp that is not a parseable date', () => {
    const text = [
      line({
        ...envelope,
        type: 'user',
        timestamp: '2026-09-01T10:00:00.000Z',
        message: { content: 'hi' },
      }),
      line({ ...envelope, type: 'assistant', timestamp: 'not a date', message: { content: [] } }),
    ].join('\n');
    expect(parseTranscript(text).record.lastActivity).toBe(Date.parse('2026-09-01T10:00:00.000Z'));
  });

  it('drops sidechain lines from the recap', () => {
    const text = [
      assistant([{ type: 'text', text: 'main agent' }]),
      { ...assistant([{ type: 'text', text: 'subagent' }]), isSidechain: true },
    ]
      .map(line)
      .join('\n');
    expect(parseTranscript(text).record.recap).toBe('main agent');
  });
});
