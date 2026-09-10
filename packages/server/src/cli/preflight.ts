import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseTmuxVersion, tmuxVersionAtLeast, type TmuxVersion } from '@garden/shared';

const execFileAsync = promisify(execFile);

/** `window-size latest` and `terminal-features`, both in `appdir.ts`'s tmux.conf, need 3.2. */
const MINIMUM_TMUX_VERSION: TmuxVersion = { major: 3, minor: 2 };

export type PreflightResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

function formatVersion(version: TmuxVersion): string {
  return `${String(version.major)}.${String(version.minor)}`;
}

export function evaluateTmuxVersion(versionOutput: string): PreflightResult {
  const found = parseTmuxVersion(versionOutput);
  if (!found) {
    return {
      ok: false,
      message: `garden requires tmux ${formatVersion(MINIMUM_TMUX_VERSION)} or newer — could not read a version from "${versionOutput.trim()}"`,
    };
  }
  return tmuxVersionAtLeast(found, MINIMUM_TMUX_VERSION)
    ? { ok: true }
    : {
        ok: false,
        message: `garden requires tmux ${formatVersion(MINIMUM_TMUX_VERSION)} or newer, found ${formatVersion(found)}`,
      };
}

export async function checkTmux(): Promise<PreflightResult> {
  try {
    const { stdout } = await execFileAsync('tmux', ['-V']);
    return evaluateTmuxVersion(stdout);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, message: 'tmux is not installed — install it and try again' };
    }
    return { ok: false, message: `could not run tmux: ${(error as Error).message}` };
  }
}
