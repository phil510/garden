import { describe, expect, it } from 'vitest';
import { parseCodexTranscript } from './transcript.js';
const line = (type: string, payload: unknown, timestamp = '2026-11-15T00:00:00Z') =>
  JSON.stringify({ type, payload, timestamp });

describe('Codex rollout projection', () => {
  it('uses the latest real user turn and assistant event while ignoring tool and context messages', () => {
    const parsed = parseCodexTranscript(
      [
        line('session_meta', { id: 'native', cwd: '/repo' }),
        line('event_msg', { type: 'user_message', message: 'first prompt' }),
        line('response_item', {
          role: 'user',
          content: [{ type: 'input_text', text: 'system instructions' }],
        }),
        line('event_msg', { type: 'agent_message', message: 'old response' }),
        line('turn_context', { cwd: '/repo/.worktrees/topic' }),
        line('event_msg', { type: 'user_message', message: 'latest prompt' }),
        line(
          'event_msg',
          { type: 'agent_message', message: 'latest response' },
          '2026-11-15T01:00:00Z',
        ),
        line('event_msg', { type: 'token_count' }, 'invalid'),
        '{broken',
      ].join('\n'),
      'garden',
    );
    expect(parsed).toEqual({
      record: {
        sessionId: 'garden',
        cwd: '/repo/.worktrees/topic',
        title: null,
        lastPrompt: 'latest prompt',
        recap: 'latest response',
        lastActivity: Date.parse('2026-11-15T01:00:00Z'),
      },
      skipped: 1,
    });
  });
  it('accepts an empty or incomplete rollout without manufacturing transcript fields', () => {
    expect(parseCodexTranscript('', 'garden').record).toEqual({
      sessionId: 'garden',
      cwd: null,
      title: null,
      lastPrompt: null,
      recap: null,
      lastActivity: null,
    });
    expect(parseCodexTranscript('[]\nnull\n', 'garden').skipped).toBe(2);
  });
});
