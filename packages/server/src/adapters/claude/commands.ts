import type { EffortLevel } from '@garden/shared';

export interface ClaudeLaunchOptions {
  readonly id: string;
  readonly cwd: string;
  readonly model?: string;
  readonly effort?: EffortLevel;
  readonly permissionMode?: 'default' | 'bypassPermissions';
}

export function claudeCommand(
  command: readonly string[],
  operation: 'spawn' | 'resume',
  settingsPath: string,
  request: ClaudeLaunchOptions,
): readonly string[] {
  return [
    ...command,
    operation === 'spawn' ? '--session-id' : '--resume',
    request.id,
    ...(request.permissionMode === 'bypassPermissions'
      ? ['--permission-mode', 'bypassPermissions']
      : []),
    ...(request.model === undefined ? [] : ['--model', request.model]),
    ...(request.effort === undefined ? [] : ['--effort', request.effort]),
    '--settings',
    settingsPath,
  ];
}
