import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appDirPath } from './config.js';

/**
 * Passed as `-f` on every tmux command. remain-on-exit must be in force when the
 * server starts, which a conf file guarantees and a later set-option cannot.
 */
export const TMUX_CONF = [
  'set-option -g remain-on-exit on',
  'set-option -g mouse on',
  'set-option -g status off',
  'set-option -g default-terminal tmux-256color',
  'set-option -g terminal-features ",*:RGB"',
  'set-option -g aggressive-resize on',
  'set-option -g window-size latest',
  '',
].join('\n');

/** Writes the conf, replacing any previous copy, and returns its path. */
export function writeTmuxConf(home: string = homedir()): string {
  const dir = appDirPath(home);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'tmux.conf');
  writeFileSync(path, TMUX_CONF, 'utf8');
  return path;
}
