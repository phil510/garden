import { describe, expect, it } from 'vitest';
import { isEffortLevel, isModelName } from './index.js';

describe('isEffortLevel', () => {
  it('accepts each level the claude CLI offers', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(isEffortLevel(level)).toBe(true);
    }
  });

  it('rejects empty, wrong-case and unknown values', () => {
    for (const value of ['', 'HIGH', 'extreme']) {
      expect(isEffortLevel(value)).toBe(false);
    }
  });
});

describe('isModelName', () => {
  it('accepts an alias or a full model name', () => {
    expect(isModelName('opus')).toBe(true);
    expect(isModelName('claude-opus-5-5')).toBe(true);
  });

  it('rejects empty and whitespace-padded values', () => {
    expect(isModelName('')).toBe(false);
    expect(isModelName('  ')).toBe(false);
    expect(isModelName(' opus')).toBe(false);
  });

  it('rejects a value that would parse as a claude flag', () => {
    expect(isModelName('-x')).toBe(false);
    expect(isModelName('--foo')).toBe(false);
  });
});
