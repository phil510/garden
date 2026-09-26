import { describe, expect, it } from 'vitest';
import { resolveSwarmRename } from './resolveSwarmRename';

describe('resolveSwarmRename', () => {
  it('commits a trimmed, changed name', () => {
    expect(resolveSwarmRename('Old name', '  New name  ')).toBe('New name');
  });

  it('is a no-op when the draft is unchanged from the current name', () => {
    expect(resolveSwarmRename('Same name', 'Same name')).toBeNull();
  });

  it('is a no-op when the trimmed draft is empty', () => {
    expect(resolveSwarmRename('Old name', '   ')).toBeNull();
  });

  it('treats a name that only differs from the current one by whitespace as unchanged', () => {
    expect(resolveSwarmRename('Same name', '  Same name  ')).toBeNull();
  });
});
