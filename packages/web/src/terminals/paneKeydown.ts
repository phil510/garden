export interface PaneKeydownEvent {
  type: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type PaneKeydownDisposition = 'literal-newline' | 'suppress' | 'default';

/** xterm's `attachCustomKeyEventHandler` runs the same callback for `keydown`, `keyup`, and
 *  `keypress` — one physical keystroke, three calls. Only the `keydown` call writes the newline;
 *  `keyup` and `keypress` for the same key still need `'suppress'` rather than `'default'`,
 *  because a canceled `keydown` does not stop every browser from firing `keypress` anyway (Firefox
 *  fires it regardless of `preventDefault`) — left as `'default'`, that stray `keypress` would run
 *  xterm's normal Enter handling and send a trailing carriage return after the newline. Every
 *  other key, and every other modifier combination on Enter, is left to xterm's own handling. */
export function resolvePaneKeydown(event: PaneKeydownEvent): PaneKeydownDisposition {
  const isShiftEnter =
    event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
  if (!isShiftEnter) return 'default';
  return event.type === 'keydown' ? 'literal-newline' : 'suppress';
}
