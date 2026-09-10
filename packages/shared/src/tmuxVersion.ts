/** `major.minor` as parsed from `tmux -V`. tmux's trailing patch letter (e.g. "3.6a") and any
 *  branch prefix (e.g. "next-3.4") are not part of the comparison. */
export interface TmuxVersion {
  major: number;
  minor: number;
}

/** Returns null when no version can be read, rather than throwing — callers decide what an
 *  unparseable string means for them. */
export function parseTmuxVersion(versionOutput: string): TmuxVersion | null {
  const match = /(\d+)\.(\d+)/.exec(versionOutput);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export function tmuxVersionAtLeast(version: TmuxVersion, minimum: TmuxVersion): boolean {
  return (
    version.major > minimum.major ||
    (version.major === minimum.major && version.minor >= minimum.minor)
  );
}
