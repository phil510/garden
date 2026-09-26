import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { listPanes, newSession } from '../../src/adapters/tmux.js';
import { until } from './support/poll.js';
import { withTmuxServer } from './support/tmux-server.js';

describe('a session whose command exits', () => {
  it.each([
    ['a clean exit', 'exit 0', 0],
    ['a non-zero exit', 'exit 7', 7],
  ])('leaves a dead pane carrying the exit code after %s', async (_label, script, code) => {
    await withTmuxServer(async (target) => {
      // This is the first command on the socket, so it is what starts the server
      // and loads the conf that sets remain-on-exit.
      await newSession(target, {
        name: 'ephemeral',
        cwd: tmpdir(),
        port: 4310,
        sessionId: 'ephemeral-id',
        command: ['sh', '-c', script],
      });

      const panes = await until(
        'the pane to be reported dead',
        () => listPanes(target),
        (list) => list[0]?.dead === true,
      );

      // The session outlived its command: that is the whole liveness model.
      expect(panes).toHaveLength(1);
      expect(panes[0]).toEqual({ session: 'ephemeral', dead: true, exitCode: code });
    });
  });
});
