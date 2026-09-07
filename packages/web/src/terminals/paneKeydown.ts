export interface PaneKeydownEvent {
  type: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type PaneKeydownDisposition = 'literal-newline' | 'default';

/** xterm's `attachCustomKeyEventHandler` runs the same callback for `keydown`, `keyup`, and
 *  `keypress` — one physical keystroke, three calls — so the `type` check is what keeps
 *  Shift+Enter from sending three newlines instead of one. Every other key, and every other
 *  modifier combination on Enter, is left to xterm's own handling. */
export function resolvePaneKeydown(event: PaneKeydownEvent): PaneKeydownDisposition {
  const isPlainShiftEnter =
    event.type === 'keydown' &&
    event.key === 'Enter' &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey;
  return isPlainShiftEnter ? 'literal-newline' : 'default';
}
