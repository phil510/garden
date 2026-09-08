// The module under test is scripts/fake-transcript.ts, which no vitest project covers — the
// unit tier is `packages/server/src/**/*.test.ts`. It sits here instead, next to the parser it
// is pinned against: the point of the test is that the two agree, and every disagreement
// between them shows up as a null fact rather than an error.
import { describe, expect, it } from 'vitest';
import { openingTranscript } from '../../../scripts/fake-transcript.js';
import { parseTranscript } from './domain/transcript.js';

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
});
