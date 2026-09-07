import { aHookEvent } from '@garden/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { claudeSettings } from './appdir.js';
import { hookOutcome } from './domain/status.js';

describe('claudeSettings', () => {
  it('registers a hook only for events that status derivation actually understands', () => {
    for (const event of Object.keys(claudeSettings().hooks)) {
      const outcome = hookOutcome(aHookEvent({ hook_event_name: event }));
      expect(outcome.status !== null || outcome.ended !== null).toBe(true);
    }
  });

  it('matches every tool on the tool events and takes no matcher on the lifecycle events', () => {
    const matchers = Object.fromEntries(
      Object.entries(claudeSettings().hooks).map(([event, groups]) => [
        event,
        groups.map((group) => group.matcher),
      ]),
    );
    expect(matchers).toEqual({
      SessionStart: [undefined],
      SessionEnd: [undefined],
      UserPromptSubmit: [undefined],
      Stop: [undefined],
      Notification: [undefined],
      PreToolUse: ['*'],
      PostToolUse: ['*'],
      PermissionRequest: ['*'],
    });
  });

  it('makes every hook synchronous with a one-second timeout and an unexpanded port', () => {
    const hooks = claudeSettings().hooks;
    const commands = Object.values(hooks)
      .flat()
      .flatMap((group) => group.hooks);
    expect(commands).toHaveLength(Object.keys(hooks).length);
    for (const command of commands) {
      expect(command.type).toBe('command');
      expect(command.timeout).toBe(1);
      // An async hook is killed when claude exits, so SessionEnd would never land.
      expect(command).not.toHaveProperty('async');
      expect(command.command).toContain('http://127.0.0.1:$GARDEN_PORT/hooks');
    }
  });
});
