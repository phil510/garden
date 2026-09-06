import { describe, expect, it } from 'vitest';
import { gitStatusBadge } from './gitStatusBadge';

describe('gitStatusBadge', () => {
  it('reads an untracked path as U', () => {
    expect(gitStatusBadge('??')).toEqual({ letter: 'U', className: 'gstat gU' });
  });

  it('reads a staged addition, a rename and a copy as A', () => {
    expect(gitStatusBadge('A ')).toEqual({ letter: 'A', className: 'gstat gA' });
    expect(gitStatusBadge('R ')).toEqual({ letter: 'A', className: 'gstat gA' });
    expect(gitStatusBadge('C ')).toEqual({ letter: 'A', className: 'gstat gA' });
  });

  it('reads a modification on either side of the index as M', () => {
    expect(gitStatusBadge(' M')).toEqual({ letter: 'M', className: 'gstat gM' });
    expect(gitStatusBadge('M ')).toEqual({ letter: 'M', className: 'gstat gM' });
  });

  it('reads a deletion as M', () => {
    expect(gitStatusBadge(' D')).toEqual({ letter: 'M', className: 'gstat gM' });
  });

  it('carries no badge for a clean, ignored or unmerged path', () => {
    expect(gitStatusBadge(null)).toBeNull();
    expect(gitStatusBadge('!!')).toBeNull();
    expect(gitStatusBadge('UU')).toBeNull();
  });
});
