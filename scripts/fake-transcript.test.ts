// Pinned against garden's real parser: the point is that the two agree, and every
// disagreement between them shows up as a null fact rather than an error.
import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../packages/server/src/domain/transcript.js';
import { keywordTranscriptLine, openingTranscript } from './fake-transcript.js';

describe('the fake claude transcript', () => {
  const facts = {
    sessionId: '9f1c0d3e-4b2a-4f77-9a51-0c8e2b6d4a10',
    cwd: '/tmp/garden-sandbox/fixture-repo',
    gitBranch: 'main',
    title: 'a session with a title',
    prompt: 'the prompt a person typed',
    recap: 'what the assistant said last',
  };
  const at = new Date('2026-09-07T12:34:56.000Z');

  it('parses into every session fact garden surfaces', () => {
    const { record, skipped } = parseTranscript(openingTranscript(facts, at));

    expect(skipped).toBe(0);
    expect(record).toEqual({
      sessionId: facts.sessionId,
      cwd: facts.cwd,
      gitBranch: facts.gitBranch,
      title: facts.title,
      lastPrompt: facts.prompt,
      recap: facts.recap,
      lastActivity: at.getTime(),
    });
  });

  it('reports no branch without losing the facts that share its line', () => {
    const { record } = parseTranscript(openingTranscript({ ...facts, gitBranch: null }, at));

    expect(record.gitBranch).toBeNull();
    expect(record.cwd).toBe(facts.cwd);
    expect(record.sessionId).toBe(facts.sessionId);
  });

  it('moves recap and lastActivity when a keyword line is appended, without losing sessionId', () => {
    const later = new Date('2026-09-07T13:00:00.000Z');
    const text =
      openingTranscript(facts, at) + keywordTranscriptLine(facts, 'Approved via /approve.', later);
    const { record, skipped } = parseTranscript(text);

    expect(skipped).toBe(0);
    expect(record.recap).toBe('Approved via /approve.');
    expect(record.lastActivity).toBe(later.getTime());
    expect(record.sessionId).toBe(facts.sessionId);
  });
});
