import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTmuxVersion } from '../../src/adapters/tmux.js';

// The pure threshold logic (assertTmuxVersion) is unit-tested beside its source. This
// proves the `tmux -V` process boundary itself: the real binary on this machine, and
// the real ENOENT/EACCES a missing or unrunnable binary produces — nothing here is mocked.

describe('checkTmuxVersion', () => {
  it('resolves against the real tmux on this machine (CI builds 3.6a; local dev needs 3.6+)', async () => {
    await expect(checkTmuxVersion()).resolves.toBeUndefined();
  });

  describe('against a controlled PATH', () => {
    const originalPath = process.env.PATH;
    let dir: string | undefined;

    afterEach(() => {
      process.env.PATH = originalPath;
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    });

    it('throws a tailored "not installed" message on the real ENOENT', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-no-tmux-'));
      process.env.PATH = dir;

      await expect(checkTmuxVersion()).rejects.toThrow(
        'tmux is not installed — install it and try again',
      );
    });

    it('throws a generic "could not run" message on a real non-ENOENT failure (EACCES)', async () => {
      dir = mkdtempSync(join(tmpdir(), 'garden-unrunnable-tmux-'));
      const fakeTmux = join(dir, 'tmux');
      writeFileSync(fakeTmux, '#!/bin/sh\necho not actually tmux\n', { mode: 0o644 });
      process.env.PATH = dir;

      await expect(checkTmuxVersion()).rejects.toThrow(/could not run tmux/);
    });
  });
});
