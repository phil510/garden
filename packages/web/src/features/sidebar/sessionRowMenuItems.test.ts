import { describe, expect, it } from 'vitest';
import { sessionRowMenuAction, sessionRowMenuItems } from './sessionRowMenuItems';

const killItem = { key: 'kill', label: 'Kill session', danger: true };
const killConfirmItem = { key: 'kill-confirm', label: 'Confirm kill', danger: true };
const resumeItem = { key: 'resume', label: 'Resume', danger: false };
const resumeConfirmItem = { key: 'resume-confirm', label: 'Confirm resume', danger: false };

const watchPrItem = { key: 'watch-pr', label: 'Watch a PR…', danger: false };

const addToSwarmItem = (
  activeSwarms: { swarmId: string; name: string }[] = [],
  filterable = false,
) => ({
  key: 'add-to-swarm',
  label: 'Add to swarm',
  danger: false,
  submenu: {
    items: activeSwarms.map((swarm) => ({
      key: `add-swarm:${swarm.swarmId}`,
      label: swarm.name,
      danger: false,
    })),
    filterable,
    footer: { key: 'new-swarm', label: 'New swarm…', danger: false },
  },
});

describe('sessionRowMenuItems', () => {
  it('shows Add to swarm then Kill session for a live, un-confirmed, solo row', () => {
    expect(sessionRowMenuItems(false, null)).toEqual([watchPrItem, addToSwarmItem(), killItem]);
  });

  it('shows Confirm kill for a live row mid-kill-confirm', () => {
    expect(sessionRowMenuItems(false, 'kill')).toEqual([
      watchPrItem,
      addToSwarmItem(),
      killConfirmItem,
    ]);
  });

  it('shows Resume for a dead, un-confirmed row', () => {
    expect(sessionRowMenuItems(true, null)).toEqual([watchPrItem, addToSwarmItem(), resumeItem]);
  });

  it('shows Confirm resume for a dead row mid-resume-confirm', () => {
    expect(sessionRowMenuItems(true, 'resume')).toEqual([
      watchPrItem,
      addToSwarmItem(),
      resumeConfirmItem,
    ]);
  });

  it('ignores a mismatched confirming value for a live row', () => {
    expect(sessionRowMenuItems(false, 'resume')).toEqual([watchPrItem, addToSwarmItem(), killItem]);
  });

  it('ignores a mismatched confirming value for a dead row', () => {
    expect(sessionRowMenuItems(true, 'kill')).toEqual([watchPrItem, addToSwarmItem(), resumeItem]);
  });

  it('adds Remove from swarm only when the session currently resolves to a swarm', () => {
    const withSwarm = sessionRowMenuItems(false, null, 'swarm-1');
    expect(withSwarm).toEqual([
      watchPrItem,
      addToSwarmItem(),
      { key: 'remove-swarm', label: 'Remove from swarm', danger: false },
      killItem,
    ]);

    const solo = sessionRowMenuItems(false, null, undefined);
    expect(solo).toEqual([watchPrItem, addToSwarmItem(), killItem]);
  });

  it('lists active swarms in the order given, without a filter at or below 8 entries', () => {
    const swarms = Array.from({ length: 8 }, (_, i) => ({ swarmId: `s${i}`, name: `Swarm ${i}` }));
    const items = sessionRowMenuItems(false, null, undefined, swarms);
    expect(items[1]).toEqual(addToSwarmItem(swarms, false));
  });

  it('turns on the submenu filter past 8 entries', () => {
    const swarms = Array.from({ length: 9 }, (_, i) => ({ swarmId: `s${i}`, name: `Swarm ${i}` }));
    const items = sessionRowMenuItems(false, null, undefined, swarms);
    expect(items[1]).toEqual(addToSwarmItem(swarms, true));
  });

  it('always ends the Add-to-swarm submenu with New swarm…, even with no active swarms', () => {
    const items = sessionRowMenuItems(false, null);
    const submenu = items[1]!.submenu!;
    expect(submenu.items).toEqual([]);
    expect(submenu.footer).toEqual({ key: 'new-swarm', label: 'New swarm…', danger: false });
  });
});

describe('sessionRowMenuItems watches', () => {
  const watches = [
    { repo: 'acme/api', pr: 12 },
    { repo: 'acme/web', pr: 7 },
  ];

  it('omits Stop watching when the session has no watches', () => {
    expect(sessionRowMenuItems(false, null).map((item) => item.key)).not.toContain('stop-watching');
  });

  it('lists one stop item per watch, then Stop all, right after Watch a PR', () => {
    const items = sessionRowMenuItems(false, null, undefined, [], watches);
    expect(items.map((item) => item.key).slice(0, 3)).toEqual([
      'watch-pr',
      'stop-watching',
      'add-to-swarm',
    ]);
    expect(items[1]).toEqual({
      key: 'stop-watching',
      label: 'Stop watching',
      danger: false,
      submenu: {
        items: [
          { key: 'stop-watch:acme/api#12', label: '#12 acme/api', danger: false },
          { key: 'stop-watch:acme/web#7', label: '#7 acme/web', danger: false },
        ],
        filterable: false,
        footer: { key: 'stop-all', label: 'Stop all', danger: false },
      },
    });
  });

  it('relabels Stop all as a danger confirm with the watch count while confirming', () => {
    const items = sessionRowMenuItems(false, 'stop-all', undefined, [], watches);
    expect(items[1]!.submenu!.footer).toEqual({
      key: 'stop-all-confirm',
      label: 'Confirm stop all 2',
      danger: true,
    });
  });

  it('keeps the kill item unconfirmed while stop-all is confirming', () => {
    const items = sessionRowMenuItems(false, 'stop-all', undefined, [], watches);
    expect(items.at(-1)).toEqual(killItem);
  });
});

describe('sessionRowMenuAction', () => {
  it('moves stop-all into its confirm state without acting', () => {
    expect(sessionRowMenuAction('stop-all')).toEqual({ confirming: 'stop-all', act: null });
  });

  it('fires stop-all and resets confirming on stop-all-confirm', () => {
    expect(sessionRowMenuAction('stop-all-confirm')).toEqual({
      confirming: null,
      act: 'stop-all',
    });
  });

  it('moves kill into its confirm state without acting', () => {
    expect(sessionRowMenuAction('kill')).toEqual({ confirming: 'kill', act: null });
  });

  it('fires kill and resets confirming on kill-confirm', () => {
    expect(sessionRowMenuAction('kill-confirm')).toEqual({ confirming: null, act: 'kill' });
  });

  it('moves resume into its confirm state without acting', () => {
    expect(sessionRowMenuAction('resume')).toEqual({ confirming: 'resume', act: null });
  });

  it('fires resume and resets confirming on resume-confirm', () => {
    expect(sessionRowMenuAction('resume-confirm')).toEqual({ confirming: null, act: 'resume' });
  });
});
