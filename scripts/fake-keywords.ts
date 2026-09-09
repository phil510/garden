// Pure keyword→hook-event mapping the fake's REPL drives sessions with, kept apart from stdin
// and the process so the mapping can be pinned in a unit test without spawning anything.
import type { HookPayload } from '../packages/shared/src/index.js';

export type Keyword = '/approve' | '/wait' | '/end';

/** What a recognized keyword does: the hook event whose status derivation (domain/status.ts)
 *  drives the session, and the transcript recap describing why for any keyword that keeps the
 *  session alive afterward. */
export interface KeywordOutcome {
  readonly hookEventName: HookPayload['hook_event_name'];
  readonly recap: string;
}

const KEYWORD_OUTCOMES: Readonly<Record<Keyword, KeywordOutcome>> = {
  '/approve': { hookEventName: 'PermissionRequest', recap: 'Approved via /approve.' },
  '/wait': { hookEventName: 'Stop', recap: 'Waiting via /wait.' },
  '/end': { hookEventName: 'SessionEnd', recap: 'Ended via /end.' },
};

export function keywordOutcome(line: string): KeywordOutcome | null {
  return Object.hasOwn(KEYWORD_OUTCOMES, line) ? KEYWORD_OUTCOMES[line as Keyword] : null;
}
