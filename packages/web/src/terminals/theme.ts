import type { ITheme } from '@xterm/xterm';

/** Reads a resolved CSS custom property value. Injected so the mapping below stays a pure
 *  function over whatever variables the caller supplies. */
export type CssVarReader = (name: string) => string;

/**
 * xterm renders to canvas rather than through the DOM cascade, so it needs resolved colors
 * rather than `var(...)` references. This ports the base editor colors the rest of the UI
 * already uses; it does not attempt a full 16-color ANSI palette, since none of the existing
 * tokens are meant to stand in for one.
 */
export function terminalTheme(readVar: CssVarReader): ITheme {
  return {
    background: readVar('--ground'),
    foreground: readVar('--text'),
    cursor: readVar('--accent'),
    cursorAccent: readVar('--ground'),
    selectionBackground: readVar('--accent-dim'),
  };
}
