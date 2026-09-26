import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { listPanes, newSession } from '../../src/adapters/tmux.js';
import { until } from './support/poll.js';
import { type TmuxServerContext, withTmuxServer } from './support/tmux-server.js';

const sleeper = ['sh', '-c', 'sleep 30'];

const sessionNames = async (target: TmuxServerContext, count: number) => {
  const panes = await until(
    `${count} pane(s) on ${target.socket}`,
    () => listPanes(target),
    (list) => list.length === count,
  );
  return panes.map((pane) => pane.session).sort();
};

describe('two garden instances on separate tmux sockets', () => {
  // Both sockets here are fixture sockets. The scenario this stands in for is a
  // sandbox running beside the user's real garden, but naming that socket would
  // make the teardown below kill their live sessions — cross-invisibility between
  // any two independently-named sockets is the same property.
  it('keep their sessions invisible to each other, and a name used on one is free on the other', async () => {
    await withTmuxServer(async (first) => {
      await withTmuxServer(async (second) => {
        await newSession(first, {
          name: 'alpha',
          cwd: tmpdir(),
          port: 4310,
          sessionId: 'alpha-id',
          command: sleeper,
        });
        await newSession(first, {
          name: 'shared',
          cwd: tmpdir(),
          port: 4310,
          sessionId: 'shared-id',
          command: sleeper,
        });

        // A single shared server would reject this as a duplicate session name.
        await newSession(second, {
          name: 'shared',
          cwd: tmpdir(),
          port: 4311,
          sessionId: 'shared-id',
          command: sleeper,
        });

        expect(await sessionNames(first, 2)).toEqual(['alpha', 'shared']);
        expect(await sessionNames(second, 1)).toEqual(['shared']);
      });
    });
  });
});
