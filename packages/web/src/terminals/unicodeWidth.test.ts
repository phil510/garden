import { describe, expect, it } from 'vitest';
import { unicodeV11Provider } from './unicodeWidth';

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
