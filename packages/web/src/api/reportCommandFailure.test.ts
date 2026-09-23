import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { commandFailureMessage } from './reportCommandFailure';

describe('commandFailureMessage', () => {
  it("returns an ApiError's own message", () => {
    expect(commandFailureMessage(new ApiError('duplicate session'))).toBe('duplicate session');
  });

  it('falls back to a generic message for a plain Error', () => {
    expect(commandFailureMessage(new Error('ECONNREFUSED'))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('falls back to a generic message for a non-Error value', () => {
    expect(commandFailureMessage('boom')).toBe('Something went wrong. Please try again.');
  });
});
