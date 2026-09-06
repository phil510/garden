import { describe, expect, it } from 'vitest';
import { deadPaneStatusLine } from './deadPaneStatus';

describe('deadPaneStatusLine', () => {
  it('names the exit code when tmux still holds the pane', () => {
    expect(deadPaneStatusLine(0)).toBe('Not running — exited with code 0');
    expect(deadPaneStatusLine(137)).toBe('Not running — exited with code 137');
  });

  it('omits the exit code once tmux no longer holds the pane', () => {
    expect(deadPaneStatusLine(null)).toBe('Not running');
  });
});
