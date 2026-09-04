import { describe, expect, it } from 'vitest';
import { HOOK_EVENTS, claudeSettings } from './appdir.js';

describe('claudeSettings', () => {
  it('registers a hook for every event garden derives status from', () => {
    expect(Object.keys(claudeSettings().hooks).sort()).toEqual([...HOOK_EVENTS].sort());
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
    const commands = Object.values(claudeSettings().hooks)
      .flat()
      .flatMap((group) => group.hooks);
    expect(commands).toHaveLength(HOOK_EVENTS.length);
    for (const command of commands) {
      expect(command.type).toBe('command');
      expect(command.timeout).toBe(1);
      // An async hook is killed when claude exits, so SessionEnd would never land.
      expect(command).not.toHaveProperty('async');
      expect(command.command).toContain('http://127.0.0.1:$GARDEN_PORT/hooks');
    }
  });
});
