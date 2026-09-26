import { describe, expect, it } from 'vitest';
import { swarmHeaderMenuAction, swarmHeaderMenuItems } from './swarmHeaderMenuItems';

describe('swarmHeaderMenuItems', () => {
  it('shows Archive and Delete swarm… for an active, un-confirmed swarm', () => {
    expect(swarmHeaderMenuItems(false, null)).toEqual([
      { key: 'rename', label: 'Rename', danger: false },
      { key: 'toggle-archive', label: 'Archive', danger: false },
      { key: 'delete', label: 'Delete swarm…', danger: true },
    ]);
  });

  it('shows Unarchive for an archived swarm', () => {
    expect(swarmHeaderMenuItems(true, null)).toEqual([
      { key: 'rename', label: 'Rename', danger: false },
      { key: 'toggle-archive', label: 'Unarchive', danger: false },
      { key: 'delete', label: 'Delete swarm…', danger: true },
    ]);
  });

  it('shows the delete confirm item mid-confirm', () => {
    const items = swarmHeaderMenuItems(false, 'delete');
    expect(items[2]).toEqual({
      key: 'delete-confirm',
      label: 'Confirm delete — members become solo, nothing is killed',
      danger: true,
    });
  });
});

describe('swarmHeaderMenuAction', () => {
  it('moves delete into its confirm state without acting', () => {
    expect(swarmHeaderMenuAction('delete')).toEqual({ confirming: 'delete', act: null });
  });

  it('fires delete and resets confirming on delete-confirm', () => {
    expect(swarmHeaderMenuAction('delete-confirm')).toEqual({ confirming: null, act: 'delete' });
  });

  it('fires rename immediately, with no confirm step', () => {
    expect(swarmHeaderMenuAction('rename')).toEqual({ confirming: null, act: 'rename' });
  });

  it('fires toggle-archive immediately, with no confirm step', () => {
    expect(swarmHeaderMenuAction('toggle-archive')).toEqual({
      confirming: null,
      act: 'toggle-archive',
    });
  });

  it('ignores an unrecognized key', () => {
    expect(swarmHeaderMenuAction('unknown')).toEqual({ confirming: null, act: null });
  });
});
