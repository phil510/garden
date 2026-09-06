import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** `window-size latest` and `terminal-features`, both in `appdir.ts`'s tmux.conf, need 3.2. */
export const MINIMUM_TMUX_VERSION = { major: 3, minor: 2 } as const;

export type PreflightResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

function formatVersion(version: { major: number; minor: number }): string {
  return `${String(version.major)}.${String(version.minor)}`;
}

/** `tmux -V` prints e.g. "tmux 3.6a" or "tmux next-3.4"; the trailing letter is a patch suffix. */
export function evaluateTmuxVersion(versionOutput: string): PreflightResult {
  const match = /(\d+)\.(\d+)/.exec(versionOutput);
  if (!match) {
    return {
      ok: false,
      message: `garden requires tmux ${formatVersion(MINIMUM_TMUX_VERSION)} or newer — could not read a version from "${versionOutput.trim()}"`,
    };
  }
  const found = { major: Number(match[1]), minor: Number(match[2]) };
  const meetsMinimum =
    found.major > MINIMUM_TMUX_VERSION.major ||
    (found.major === MINIMUM_TMUX_VERSION.major && found.minor >= MINIMUM_TMUX_VERSION.minor);
  return meetsMinimum
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
