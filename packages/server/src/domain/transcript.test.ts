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
