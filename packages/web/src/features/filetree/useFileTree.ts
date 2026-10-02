import type { TreeEntry, TreeResponse } from '@garden/shared';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

/** Long enough to collapse a burst of hook events into one refetch, short enough that a
 *  file edited mid-turn shows up without the user having to do anything. It is the interval
 *  between refreshes, not a quiet period: activity during a turn never stops arriving, so a
 *  window that reset on each event would leave the tree stale for the whole turn. */
const REFRESH_INTERVAL_MS = 500;

/** Loaded directories, tagged with the fetcher they came from. A tree load is in flight across
 *  a source change often enough to matter, and the tag is what lets a response from a
 *  superseded fetcher be dropped instead of landing in the new fetcher's tree. */
interface TreeState {
  readonly loadDir: (path: string) => Promise<TreeResponse>;
  readonly childrenByPath: Record<string, readonly TreeEntry[]>;
}

/** Lazily-expanded directory tree under `root`; `null` means nothing to load. `refreshTrigger`
 *  is any value whose change asks for a throttled refetch of every loaded directory, and `null`
 *  means none. `loadDir` resolves a root-relative path, and the hook doesn't care how. A new
 *  `loadDir` identity starts a fresh tree; `root` only gates loading, since `root` can change
 *  under a live session whose loaded directories are still the ones to refresh. */
export function useFileTree(
  root: string | null,
  refreshTrigger: number | null,
  loadDir: (path: string) => Promise<TreeResponse>,
): {
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>;
  loadPath: (path: string) => void;
} {
  const [tree, setTree] = useState<TreeState>({ loadDir, childrenByPath: {} });
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadPath = useCallback(
    (path: string) => {
      loadDir(path)
        .then((response) => {
          setTree((current) =>
            current.loadDir === loadDir
              ? {
                  ...current,
                  childrenByPath: { ...current.childrenByPath, [path]: response.entries },
                }
              : current,
          );
        })
        .catch(() => undefined);
    },
    [loadDir],
  );

  useEffect(() => {
    setTree({ loadDir, childrenByPath: {} });
    return () => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
    };
  }, [loadDir]);

  useEffect(() => {
    if (root !== null) loadPath('');
  }, [root, loadPath]);

  // Reads the current tree without depending on it: its own writes would otherwise retrigger the
  // throttle effect below and turn the refresh into an unconditional poll.
  const refreshLoaded = useEffectEvent(() => {
    for (const path of Object.keys(tree.childrenByPath)) loadPath(path);
  });

  // Throttled, not debounced: the first trigger since the last refresh schedules the next one,
  // and everything arriving before it fires is absorbed into it. `loadPath` is a dependency only
  // to re-arm the timer that the reset effect's cleanup cleared when `loadDir` changed.
  useEffect(() => {
    if (root === null || refreshTrigger === null) return;
    if (refreshTimer.current !== undefined) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      refreshLoaded();
    }, REFRESH_INTERVAL_MS);
  }, [root, loadPath, refreshTrigger]);

  return { childrenByPath: tree.childrenByPath, loadPath };
}
