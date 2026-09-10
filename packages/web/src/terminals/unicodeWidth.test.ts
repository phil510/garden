import { describe, expect, it } from 'vitest';
import { extractWidth, packProperties, unicodeV11Provider } from './unicodeWidth';

function extractShouldJoin(value: number): boolean {
  return (value & 1) !== 0;
}

describe('unicodeV11Provider.wcwidth', () => {
  it('reports 2 cells for 🧠 (U+1F9E0), matching tmux 3.6a', () => {
    expect(unicodeV11Provider.wcwidth(0x1f9e0)).toBe(2);
  });

  it('reports 2 cells for ⚡ (U+26A1), matching tmux 3.6a', () => {
    expect(unicodeV11Provider.wcwidth(0x26a1)).toBe(2);
  });

  it('reports 1 cell for a narrow ASCII codepoint', () => {
    expect(unicodeV11Provider.wcwidth(0x0041)).toBe(1); // 'A'
  });

  it('reports 0 cells for a combining codepoint', () => {
    expect(unicodeV11Provider.wcwidth(0x0301)).toBe(0); // combining acute accent
  });
});

// `preceding` throughout is the packed property value xterm.js's UnicodeService threads through
// a line, starting at 0 for the first codepoint. These pin charProperties against the real
// UnicodeV6/UnicodeV11 algorithm (xterm.js 6.0.0's common/input/UnicodeV6.ts), which this file's
// charProperties ports unchanged, and packProperties/extractWidth against
// UnicodeService.createPropertyValue/extractWidth from the same tag.
describe('unicodeV11Provider.charProperties', () => {
  it('joins a combining mark onto a preceding narrow character, taking its width', () => {
    const preceding = unicodeV11Provider.charProperties(0x0041, 0); // 'A', preceding: none
    const joined = unicodeV11Provider.charProperties(0x0301, preceding); // combining acute accent

    expect(extractWidth(joined)).toBe(1);
    expect(extractShouldJoin(joined)).toBe(true);
  });

  it('joins a combining mark onto a preceding wide character, taking its width', () => {
    const preceding = unicodeV11Provider.charProperties(0x1f9e0, 0); // 🧠
    const joined = unicodeV11Provider.charProperties(0x0301, preceding);

    expect(extractWidth(joined)).toBe(2);
    expect(extractShouldJoin(joined)).toBe(true);
  });

  it('does not join a combining mark at the start of a line, where there is nothing to join onto', () => {
    const result = unicodeV11Provider.charProperties(0x0301, 0);

    expect(extractWidth(result)).toBe(0);
    expect(extractShouldJoin(result)).toBe(false);
  });

  it('does not join a combining mark onto a preceding character that was itself zero-width', () => {
    const zeroWidthPreceding = packProperties(0, true);

    const result = unicodeV11Provider.charProperties(0x0301, zeroWidthPreceding);

    expect(extractWidth(result)).toBe(0);
    expect(extractShouldJoin(result)).toBe(false);
  });

  it('never joins a non-combining character onto what precedes it, regardless of preceding width', () => {
    const preceding = unicodeV11Provider.charProperties(0x1f9e0, 0); // 🧠

    const result = unicodeV11Provider.charProperties(0x0041, preceding); // 'A'

    expect(extractWidth(result)).toBe(1);
    expect(extractShouldJoin(result)).toBe(false);
  });
});

describe('packProperties/extractWidth round-trip', () => {
  it.each([0, 1, 2] as const)('recovers width %i through both join-flag states', (width) => {
    expect(extractWidth(packProperties(width, false))).toBe(width);
    expect(extractWidth(packProperties(width, true))).toBe(width);
  });

  it('packs the join flag into bit 0, independent of width', () => {
    expect(packProperties(1, true) & 1).toBe(1);
    expect(packProperties(1, false) & 1).toBe(0);
  });
});
