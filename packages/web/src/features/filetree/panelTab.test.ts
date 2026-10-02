import { describe, expect, it } from 'vitest';
import { effectiveTab } from './panelTab';

describe('effectiveTab', () => {
  it('uses the persisted tab, defaulting to files', () => {
    expect(effectiveTab(null, '/a', 'editor')).toBe('editor');
    expect(effectiveTab(null, '/a', undefined)).toBe('files');
    expect(effectiveTab(null, null, undefined)).toBe('files');
  });

  it('prefers an override made for the same root over the persisted tab', () => {
    expect(effectiveTab({ root: '/a', tab: 'editor' }, '/a', 'files')).toBe('editor');
    expect(effectiveTab({ root: null, tab: 'editor' }, null, undefined)).toBe('editor');
  });

  it('ignores an override made for another root', () => {
    expect(effectiveTab({ root: '/a', tab: 'editor' }, '/b', 'files')).toBe('files');
  });
});
