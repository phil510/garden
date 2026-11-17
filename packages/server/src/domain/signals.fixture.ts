import type { HarnessSignal, ReportedStatus } from './types.js';

export function aHarnessSignal(
  overrides: Partial<Omit<HarnessSignal, 'reported'>> & {
    reported?: ReportedStatus | undefined;
  } = {},
): HarnessSignal {
  const { reported, ...rest } = overrides;
  const report = 'reported' in overrides ? reported : { status: 'working' as const, reason: null };
  return {
    sessionId: 'sid-1',
    cwd: '/Users/dev/repo',
    transcriptPath: '/t.jsonl',
    ...(report === undefined ? {} : { reported: report }),
    ended: null,
    conversationCleared: false,
    ...rest,
  };
}
