// The module under test is scripts/fake-keywords.ts, which no vitest project covers — see
// fake-transcript.test.ts for why the test sits here instead.
import { aHookEvent } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { keywordOutcome } from '../../../scripts/fake-keywords.js';
import { hookOutcome } from './domain/status.js';

describe('keywordOutcome', () => {
  it.each([
    ['/approve', 'needs-approval'],
    ['/wait', 'waiting'],
  ] as const)('derives the %s status from what /%s maps to', (keyword, status) => {
    const outcome = keywordOutcome(keyword);
    if (outcome === null) throw new Error('expected a recognized keyword');
    expect(hookOutcome(aHookEvent({ hook_event_name: outcome.hookEventName })).status).toBe(status);
  });

  it('maps /end to the hook that ends the session', () => {
    const outcome = keywordOutcome('/end');
    if (outcome === null) throw new Error('expected a recognized keyword');
    expect(hookOutcome(aHookEvent({ hook_event_name: outcome.hookEventName })).ended).toBe(true);
  });

  // 'toString' is the case worth pinning: a bare property lookup answers it with an inherited
  // function, which would reach the REPL as an outcome with an undefined hook event.
  it.each(['/nonsense', 'toString', 'constructor'])('produces no payload for %s', (line) => {
    expect(keywordOutcome(line)).toBeNull();
  });
});
