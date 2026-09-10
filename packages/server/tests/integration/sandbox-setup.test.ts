// Tests scripts/setup-sandbox.ts — a root-level script, not part of any package — from the
// server package's integration tier because that is the only tier that drives real tmux; there
// is no separate integration tier for scripts/.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { TMUX_SOCKET } from '../../src/config.js';
import { listPanes, newSession } from '../../src/adapters/tmux.js';
import { withTmuxServer } from './support/tmux-server.js';

const execFileAsync = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SETUP_SANDBOX = join(repoRoot, 'scripts', 'setup-sandbox.ts');
// A bare `tsx` specifier resolves against the process's own cwd rather than this repo, so
// --import needs tsx's loader by absolute path instead.
const TSX_LOADER = join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');

const sleeper = ['sh', '-c', 'sleep 30'];

// process.env is the base rather than a bare override object: the script's own child
// processes (tmux, git) resolve by name and need PATH, which a replaced environment drops.
function runSetupSandbox(env: Record<string, string>) {
  return execFileAsync(process.execPath, ['--import', TSX_LOADER, SETUP_SANDBOX], {
    env: { ...process.env, ...env },
  });
}

/** Runs `promise` expecting a non-zero exit and returns the rejection's code and stderr. */
async function rejection(promise: Promise<unknown>): Promise<{ code: number; stderr: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: number; stderr: string };
  }
  throw new Error('expected setup-sandbox.ts to exit non-zero');
}

describe('scripts/setup-sandbox.ts', () => {
  it('refuses a socket a live tmux server already holds, and leaves it running', async () => {
    await withTmuxServer(async (target) => {
      await newSession(target, { name: 'alpha', cwd: tmpdir(), port: 4310, command: sleeper });

      const appDir = mkdtempSync(join(tmpdir(), 'garden-sandbox-appdir-'));
      try {
        const error = await rejection(
          runSetupSandbox({ GARDEN_TMUX_SOCKET: target.socket, GARDEN_APP_DIR: appDir }),
        );

        expect(error.code).not.toBe(0);
        for (const name of [
          'GARDEN_SANDBOX_PORT',
          'GARDEN_SANDBOX_VITE_PORT',
          'GARDEN_SANDBOX_SOCKET',
          'GARDEN_SANDBOX_APP_DIR',
        ]) {
          expect(error.stderr).toContain(name);
        }

        // The refusal happened instead of killing the server: the pane the test put there is
        // still up, not swept away by an unconditional kill-server.
        expect(await listPanes(target)).toEqual([
          { session: 'alpha', dead: false, exitCode: undefined },
        ]);
      } finally {
        rmSync(appDir, { recursive: true, force: true });
      }
    });
  });

  it('succeeds on a socket whose server is not live', async () => {
    await withTmuxServer(async (target) => {
      const appDir = mkdtempSync(join(tmpdir(), 'garden-sandbox-appdir-'));
      try {
        await expect(
          runSetupSandbox({ GARDEN_TMUX_SOCKET: target.socket, GARDEN_APP_DIR: appDir }),
        ).resolves.toBeDefined();

        expect(existsSync(join(appDir, 'fixture-repo', '.git'))).toBe(true);
        expect(existsSync(join(appDir, 'config.json'))).toBe(true);
      } finally {
        rmSync(appDir, { recursive: true, force: true });
      }
    });
  });

  it('refuses the production socket without running any tmux command', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'garden-sandbox-appdir-'));
    try {
      const error = await rejection(
        runSetupSandbox({ GARDEN_TMUX_SOCKET: TMUX_SOCKET, GARDEN_APP_DIR: appDir }),
      );
      expect(error.code).not.toBe(0);
      expect(error.stderr).toContain("garden's production socket");
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });
});
