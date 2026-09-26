// @vitest-environment happy-dom
import type { SessionState } from '@garden/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRow } from './SessionRow';

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 's1',
    cwd: '/repo',
    repoRoot: '/repo',
    branch: 'main',
    title: 'session-1',
    recap: null,
    liveness: 'live',
    status: null,
    statusReason: null,
    exitCode: null,
    tmuxName: 's1',
    lastActivity: 0,
    claudeSessionName: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderRow(onSelect: (id: string) => void) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <SessionRow
        session={makeSession()}
        onStage={false}
        focused={false}
        now={0}
        onSelect={onSelect}
      />,
    );
  });
  const row = container.querySelector('.session-row');
  if (row === null) throw new Error('row did not render');
  return row;
}

/** Right-clicking the row is what SessionRow.tsx's own onContextMenu handler listens for
 *  to open the menu, so a real 'contextmenu' event exercises the exact path production uses. */
function openContextMenu(row: Element) {
  act(() => {
    row.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
  });
  const item = container.querySelector('.context-menu-item');
  if (item === null) throw new Error('context menu item did not render');
  return item;
}

describe('SessionRow', () => {
  it('stages the session on an ordinary click', () => {
    const onSelect = vi.fn();
    const row = renderRow(onSelect);

    act(() => {
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('does not stage the session when a press on a menu item releases on the row body', () => {
    const onSelect = vi.fn();
    const row = renderRow(onSelect);
    const item = openContextMenu(row);

    // The press starts on the menu item...
    act(() => {
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    // ...and releases outside the menu, on the row body. A real browser fires `click` on the
    // common ancestor of the mousedown and mouseup targets — the row itself — rather than on
    // either endpoint, which is reproduced here by dispatching it directly on the row.
    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('resumes staging on the next ordinary click after a drag-released press', () => {
    const onSelect = vi.fn();
    const row = renderRow(onSelect);
    const item = openContextMenu(row);

    act(() => {
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();

    act(() => {
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('s1');
  });
});
