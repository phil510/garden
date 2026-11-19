import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Passed as `-f` on every tmux command. remain-on-exit must be in force when the
 * server starts, which a conf file guarantees and a later set-option cannot.
 */
export const TMUX_CONF = [
  'set-option -g remain-on-exit on',
  'set-option -g mouse on',
  'set-option -g status off',
  'set-option -g default-terminal tmux-256color',
  // Without `hyperlinks` tmux drops OSC 8 before it reaches the attached client, and the
  // client here is a node-pty one, which has no terminal of its own to announce the feature.
  'set-option -g terminal-features ",*:RGB:hyperlinks"',
  'set-option -g aggressive-resize on',
  'set-option -g window-size latest',
  '',
].join('\n')

/** Writes the conf, replacing any previous copy, and returns its path. */
export function writeTmuxConf(appDir: string): string {
  mkdirSync(appDir, { recursive: true })
  const path = join(appDir, 'tmux.conf')
  writeFileSync(path, TMUX_CONF, 'utf8')
  return path
}
