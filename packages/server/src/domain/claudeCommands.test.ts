import { describe, expect, it } from 'vitest';
import { claudeCommand } from './claudeCommands.js';

describe('Claude launch argv', () => {
  it.each(['spawn', 'resume'] as const)(
    'preserves the %s argument order including every optional flag',
    (operation) => {
      expect(
        claudeCommand(
          ['node', '--import', '/a loader.mjs', '/fake.ts'],
          operation,
          '/app dir/claude-settings.json',
          {
            id: 'garden-id',
            cwd: '/repo',
            permissionMode: 'bypassPermissions',
            model: 'opus',
            effort: 'high',
          },
        ),
      ).toEqual([
        'node',
        '--import',
        '/a loader.mjs',
        '/fake.ts',
        operation === 'spawn' ? '--session-id' : '--resume',
        'garden-id',
        '--permission-mode',
        'bypassPermissions',
        '--model',
        'opus',
        '--effort',
        'high',
        '--settings',
        '/app dir/claude-settings.json',
      ]);
    },
  );
});
