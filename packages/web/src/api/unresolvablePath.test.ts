import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { isUnresolvablePath } from './unresolvablePath';

describe('isUnresolvablePath', () => {
  it.each([404, 400])('treats a %i answer as unresolvable', (status) => {
    expect(isUnresolvablePath(new ApiError('no such path', status))).toBe(true);
  });

  it('treats a server error as a real failure', () => {
    expect(isUnresolvablePath(new ApiError('boom', 500))).toBe(false);
  });

  it('treats a network failure as a real failure', () => {
    expect(isUnresolvablePath(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('treats an ApiError without a status as a real failure', () => {
    expect(isUnresolvablePath(new ApiError('not json'))).toBe(false);
  });
});
