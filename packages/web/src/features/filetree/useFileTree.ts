import type { TreeEntry, TreeResponse } from '@garden/shared';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

/** Loaded directories, tagged with the root they belong to. A root change drops them, and the
 *  tag keeps the render between the change and that drop from showing the old root's tree. */
interface TreeState {
  readonly root: string | null;
  readonly childrenByPath: Record<string, readonly TreeEntry[]>;
}

/** Lazily-expanded directory tree for one project root; `null` means nothing to load.
 *  `loadDir` resolves a root-relative path against that root and the hook doesn't care how.
 *
 *  A root change starts a fresh tree and loads `''` plus every path in `expanded`, so folders
 *  restored from storage don't render open-but-empty. A `refreshEpoch` change refetches every
 *  loaded path as one round sharing a single fresh `refresh` token. Fetches carry a sequence
 *  number and a response older than one already applied to the same path is dropped, so an
 *  out-of-order round can't regress the tree. */
export function useFileTree(
  root: string | null,
  expanded: readonly string[],
  refreshEpoch: number,
  loadDir: (path: string, refresh?: string) => Promise<TreeResponse>,
): {
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>;
  loadPath: (path: string) => void;
} {
  const [tree, setTree] = useState<TreeState>({ root, childrenByPath: {} });
  const generation = useRef(0);
  const nextSeq = useRef(0);
  const appliedSeq = useRef<Record<string, number>>({});
  const lastEpoch = useRef(refreshEpoch);

  const fetchPath = useCallback(
    (path: string, refresh?: string) => {
      const fetchGeneration = generation.current;
      const seq = ++nextSeq.current;
      loadDir(path, refresh)
        .then((response) => {
          if (generation.current !== fetchGeneration) return;
          if (seq < (appliedSeq.current[path] ?? 0)) return;
          appliedSeq.current[path] = seq;
          setTree((current) => ({
            ...current,
            childrenByPath: { ...current.childrenByPath, [path]: response.entries },
          }));
        })
        .catch(() => undefined);
    },
    [loadDir],
  );

  const loadPath = useCallback((path: string) => fetchPath(path), [fetchPath]);

  const loadInitial = useEffectEvent(() => {
    fetchPath('');
    for (const path of expanded) if (path !== '') fetchPath(path);
  });

  useEffect(() => {
    generation.current += 1;
    appliedSeq.current = {};
    setTree({ root, childrenByPath: {} });
    if (root !== null) loadInitial();
  }, [root]);

  const refreshLoaded = useEffectEvent(() => {
    const token = crypto.randomUUID();
    for (const path of Object.keys(tree.childrenByPath)) fetchPath(path, token);
  });

  useEffect(() => {
    if (lastEpoch.current === refreshEpoch) return;
    lastEpoch.current = refreshEpoch;
    if (root !== null) refreshLoaded();
  }, [root, refreshEpoch]);

  return { childrenByPath: tree.root === root ? tree.childrenByPath : {}, loadPath };
}
