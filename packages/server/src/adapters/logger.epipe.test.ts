import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'epipeChild.fixture.ts');
// A bare `tsx` specifier resolves against the child's own cwd rather than this repo, so
// --import needs tsx's loader by absolute path instead — same mechanism as
// tests/integration/fake-claude.test.ts.
const TSX_LOADER = join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');

let child: ChildProcess | undefined;

afterEach(() => {
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  child = undefined;
});

describe('a detached server whose stderr pipe has closed', () => {
  it('keeps running after logging warn then error, instead of crashing on EPIPE', async () => {
    child = spawn(process.execPath, ['--import', TSX_LOADER, FIXTURE], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    // Reproduces the CLI exiting and closing its end of the pipe right after the health
    // check observes readiness — deterministic (confirmed empirically), no readiness
    // handshake needed.
    child.stderr?.destroy();

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child?.on('exit', (code, signal) => {
          resolve({ code, signal });
        });
        child?.on('error', reject);
      },
    );

    expect(exit).toEqual({ code: 0, signal: null });
  }, 15000);
});
