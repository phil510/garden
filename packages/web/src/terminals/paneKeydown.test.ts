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
    expect(resolvePaneKeydown(anEvent({ ctrlKey: true }))).toBe('default');
  });

  it('leaves Alt+Enter to xterm', () => {
    expect(resolvePaneKeydown(anEvent({ altKey: true }))).toBe('default');
  });

  it('leaves Meta+Enter to xterm', () => {
    expect(resolvePaneKeydown(anEvent({ metaKey: true }))).toBe('default');
  });

  it('leaves Shift held on a non-Enter key to xterm', () => {
    expect(resolvePaneKeydown(anEvent({ key: 'a', shiftKey: true }))).toBe('default');
  });

  it('suppresses, but does not re-send, the keyup for the same Shift+Enter press', () => {
    expect(resolvePaneKeydown(anEvent({ type: 'keyup', shiftKey: true }))).toBe('suppress');
  });

  it('suppresses, but does not re-send, the keypress for the same Shift+Enter press', () => {
    expect(resolvePaneKeydown(anEvent({ type: 'keypress', shiftKey: true }))).toBe('suppress');
  });
});
