import type { CSSProperties } from 'react';
import type { ThemedToken } from 'shiki';

// Shiki's `fontStyle` is a bitmask of None/Italic/Bold/Underline. Its own `FontStyle` is a
// `const enum`, which isolatedModules builds can't import as a runtime value, so the bits
// are named here instead.
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;

/** A token's shiki color and font style translated into inline React styles. */
export function tokenStyle(token: ThemedToken): CSSProperties {
  const style: CSSProperties = { color: token.color };
  const fontStyle = token.fontStyle ?? 0;
  if (fontStyle & ITALIC) style.fontStyle = 'italic';
  if (fontStyle & BOLD) style.fontWeight = 'bold';
  if (fontStyle & UNDERLINE) style.textDecoration = 'underline';
  return style;
}
