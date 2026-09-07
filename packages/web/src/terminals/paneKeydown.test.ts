import { describe, expect, it } from 'vitest';
import { resolvePaneKeydown, type PaneKeydownEvent } from './paneKeydown.js';

function anEvent(overrides: Partial<PaneKeydownEvent> = {}): PaneKeydownEvent {
  return {
    type: 'keydown',
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('resolvePaneKeydown', () => {
  it('sends a literal newline for Shift+Enter on keydown', () => {
    expect(resolvePaneKeydown(anEvent({ shiftKey: true }))).toBe('literal-newline');
  });

  it('leaves plain Enter to xterm', () => {
    expect(resolvePaneKeydown(anEvent())).toBe('default');
  });

  it('leaves Ctrl+Enter to xterm', () => {
    expect(resolvePaneKeydown(anEvent({ shiftKey: true, ctrlKey: true }))).toBe('default');
  });

  it('leaves Alt+Enter to xterm', () => {
    expect(resolvePaneKeydown(anEvent({ shiftKey: true, altKey: true }))).toBe('default');
  });

  it('leaves Meta+Enter to xterm', () => {
    expect(resolvePaneKeydown(anEvent({ shiftKey: true, metaKey: true }))).toBe('default');
  });

  it('leaves Shift held on a non-Enter key to xterm', () => {
    expect(resolvePaneKeydown(anEvent({ key: 'a', shiftKey: true }))).toBe('default');
  });

  it('does not reclassify the same Shift+Enter press on keyup or keypress', () => {
    expect(resolvePaneKeydown(anEvent({ type: 'keyup', shiftKey: true }))).toBe('default');
    expect(resolvePaneKeydown(anEvent({ type: 'keypress', shiftKey: true }))).toBe('default');
  });
});
