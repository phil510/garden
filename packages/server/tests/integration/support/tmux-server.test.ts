import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { withTmuxServer } from './tmux-server.js';

const execFileAsync = promisify(execFile);

function start(socket: string, confPath: string, name: string) {
  return execFileAsync('tmux', [
    '-L',
    socket,
    '-f',
    confPath,
    'new-session',
    '-d',
    '-s',
    name,
    '--',
    'sh',
    '-c',
    'sleep 30',
  ]);
}

describe('withTmuxServer', () => {
  it('gives each call its own socket and kills the server afterwards', async () => {
    const sockets: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      await withTmuxServer(async ({ socket, confPath }) => {
        sockets.push(socket);
        await start(socket, confPath, 'fixture');
        const listed = await execFileAsync('tmux', [
          '-L',
          socket,
          'list-sessions',
          '-F',
          '#{session_name}',
        ]);
        expect(listed.stdout.trim()).toBe('fixture');
      });
    }
    expect(new Set(sockets).size).toBe(2);
    for (const socket of sockets) {
      await expect(execFileAsync('tmux', ['-L', socket, 'list-sessions'])).rejects.toThrow();
    }
  });

  it('kills the server even when the body throws', async () => {
    let socket = '';
    await expect(
      withTmuxServer(async (ctx) => {
        socket = ctx.socket;
        await start(ctx.socket, ctx.confPath, 'doomed');
        throw new Error('assertion failed inside the fixture');
      }),
    ).rejects.toThrow('assertion failed inside the fixture');
    await expect(execFileAsync('tmux', ['-L', socket, 'list-sessions'])).rejects.toThrow();
  });
});
