import { describe, expect, it } from 'vitest';
import { parseNonNegativeInt } from './index.js';

describe('parseNonNegativeInt', () => {
  it('accepts a non-negative integer string', () => {
    expect(parseNonNegativeInt('30')).toBe(30);
    expect(parseNonNegativeInt('0')).toBe(0);
  });

  it('rejects an empty string', () => {
    expect(parseNonNegativeInt('')).toBeUndefined();
  });

  it('rejects a whitespace-only string', () => {
    expect(parseNonNegativeInt('   ')).toBeUndefined();
  });

  it('rejects a fractional value', () => {
    expect(parseNonNegativeInt('0.5')).toBeUndefined();
  });

  it('rejects a negative value', () => {
    expect(parseNonNegativeInt('-1')).toBeUndefined();
  });

  it('rejects a non-numeric value', () => {
    expect(parseNonNegativeInt('nope')).toBeUndefined();
  });
});
