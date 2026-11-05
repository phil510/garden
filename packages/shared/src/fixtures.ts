import type { HookPayload, ReviewItem, ReviewQueue, SessionState, WatchSummary } from './index.js';

// One shared array so two default sessions are `Object.is`-equal on `watches`, as the server's
// reducer keeps them.
const NO_WATCHES: WatchSummary[] = [];

export function aSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    cwd: '/Users/dev/repo',
    repoRoot: '/Users/dev/repo',
    branch: 'main',
    title: 'A session',
    recap: null,
    liveness: 'live',
    status: 'unknown',
    statusReason: null,
    exitCode: null,
    tmuxName: 'repo',
    lastActivity: 1_000_000,
    claudeSessionName: null,
    watches: NO_WATCHES,
    alert: null,
    pipeConnected: false,
    pipeLastConnectedAt: null,
    ...overrides,
  };
}

export function aHookEvent(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'a1b2c3d4-0000-4000-8000-000000000001',
    cwd: '/Users/dev/repo',
    transcript_path:
      '/Users/dev/.claude/projects/-Users-dev-repo/a1b2c3d4-0000-4000-8000-000000000001.jsonl',
    hook_event_name: 'UserPromptSubmit',
    permission_mode: 'default',
    ...overrides,
  };
}

export function aReviewItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    key: 'acme/widgets#1',
    repo: 'acme/widgets',
    number: 1,
    title: 'A pull request',
    author: 'octocat',
    url: 'https://github.com/acme/widgets/pull/1',
    draft: false,
    updatedAt: '2026-11-04T12:00:00Z',
    clonePath: null,
    sessionId: null,
    ...overrides,
  };
}

export function aReviewQueue(overrides: Partial<ReviewQueue> = {}): ReviewQueue {
  return { items: [], polledAt: '2026-11-04T12:05:00Z', fault: null, ...overrides };
}
