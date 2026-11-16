import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCodexTranscript } from './transcript.js';
const line = (type: string, payload: unknown, timestamp = '2026-11-15T00:00:00Z') =>
  JSON.stringify({ type, payload, timestamp });

describe('Codex rollout projection', () => {
  it('projects captured native messages, excluding injected context before the first user turn', () => {
    const records = readFileSync(
      new URL('./fixtures/native-messages.jsonl', import.meta.url),
      'utf8',
    )
      .trimEnd()
      .split('\n');
    expect(parseCodexTranscript(records[0]!, 'garden').record).toMatchObject({
      lastPrompt: null,
      recap: null,
    });
    expect(parseCodexTranscript(records.slice(0, 3).join('\n'), 'garden').record).toMatchObject({
      lastPrompt: 'Reply exactly FIRST_OK. Do not use tools or access files.',
      recap: 'FIRST_OK',
    });
    expect(parseCodexTranscript(records.join('\n'), 'garden').record).toMatchObject({
      sessionId: 'garden',
      lastPrompt: 'Reply exactly QUEUE_OK. Do not use tools or access files.',
      recap: 'QUEUE_OK',
      lastActivity: Date.parse('2026-11-16T18:22:57.549Z'),
    });
  });

  it('joins matching text parts and excludes context, other roles, tools and non-text parts', () => {
    const parsed = parseCodexTranscript(
      [
        line('response_item', {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'injected context' },
            { type: 'input_text', text: 'first paragraph' },
            { type: 'input_image', image_url: 'https://example.com/image.png' },
            { type: 'input_text', text: 'second paragraph' },
            { type: 'output_text', text: 'wrong direction' },
          ],
          internal_chat_message_metadata_passthrough: {
            content_item_kinds: [
              'environments.environment_context',
              'user.text',
              'user.image',
              'user.text',
              'user.text',
            ],
          },
        }),
        line('response_item', {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [
            { type: 'output_text', text: 'answer paragraph' },
            { type: 'input_text', text: 'wrong direction' },
            { type: 'output_text', text: 'another paragraph' },
          ],
        }),
        ...['system', 'developer', 'tool'].map((role) =>
          line('response_item', {
            type: 'message',
            role,
            content: [{ type: 'input_text', text: 'not a prompt' }],
          }),
        ),
        line('response_item', { type: 'function_call_output', output: 'tool result' }),
        line('response_item', { type: 'reasoning', summary: [{ text: 'reasoning' }] }),
        line('response_item', { type: 'message', role: 'user', content: null }),
      ].join('\n'),
      'garden',
    );
    expect(parsed.record).toMatchObject({
      lastPrompt: 'first paragraph\nsecond paragraph',
      recap: 'answer paragraph\nanother paragraph',
    });
  });

  it('keeps the final answer when later progress and mirrored legacy events arrive', () => {
    const parsed = parseCodexTranscript(
      [
        line('event_msg', { type: 'user_message', message: 'prompt' }),
        line('response_item', {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'prompt' }],
        }),
        line('response_item', {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'final response' }],
        }),
        line('event_msg', { type: 'agent_message', message: 'final response' }),
        ...['commentary', 'partial_answer', 'unknown'].map((phase) =>
          line('response_item', {
            type: 'message',
            role: 'assistant',
            phase,
            content: [{ type: 'output_text', text: 'progress' }],
          }),
        ),
        line('event_msg', { type: 'agent_message', message: 'progress' }),
      ].join('\n'),
      'garden',
    );
    expect(parsed.record).toMatchObject({ lastPrompt: 'prompt', recap: 'final response' });
  });

  it('accepts messages without optional phase or input annotations from older rollouts', () => {
    expect(
      parseCodexTranscript(
        [
          line('response_item', {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'legacy prompt' }],
          }),
          line('response_item', {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'legacy answer' }],
          }),
        ].join('\n'),
        'garden',
      ).record,
    ).toMatchObject({ lastPrompt: 'legacy prompt', recap: 'legacy answer' });
  });

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
