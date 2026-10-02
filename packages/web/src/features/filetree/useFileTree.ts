import type { TreeEntry, TreeResponse } from '@garden/shared';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { commandFailureMessage } from '../../api/reportCommandFailure';
import { applyDirResult, emptyDirLoads, refreshPaths, type DirLoadState } from './dirLoads';

/** Directory loads, tagged with the root they belong to. A root change drops them, and the
 *  tag keeps the render between the change and that drop from showing the old root's tree. */
interface TreeState extends DirLoadState {
  readonly root: string | null;
}

/** Lazily-expanded directory tree for one project root; `null` means nothing to load.
 *  `loadDir` resolves a root-relative path against that root and the hook doesn't care how.
 *
 *  A root change starts a fresh tree and loads `''` plus every path in `expanded`, so folders
 *  restored from storage don't render open-but-empty. A `refreshEpoch` change refetches every
 *  loaded path as one round sharing a single fresh `refresh` token. Fetches carry a sequence
 *  number and a response older than one already applied to the same path is dropped, so an
 *  out-of-order round can't regress the tree. A failed fetch is recorded in `errorByPath` and
 *  drops that path's children; a later successful fetch clears it. */
export function useFileTree(
  root: string | null,
  expanded: readonly string[],
  refreshEpoch: number,
  loadDir: (path: string, refresh?: string) => Promise<TreeResponse>,
): {
  childrenByPath: Readonly<Record<string, readonly TreeEntry[]>>;
  errorByPath: Readonly<Record<string, string>>;
  loadPath: (path: string) => void;
} {
  const [tree, setTree] = useState<TreeState>({ root, ...emptyDirLoads });
  const generation = useRef(0);
  const nextSeq = useRef(0);
  const lastEpoch = useRef(refreshEpoch);

  const fetchPath = useCallback(
    (path: string, refresh?: string) => {
      const fetchGeneration = generation.current;
      const seq = ++nextSeq.current;
      const apply = (outcome: Parameters<typeof applyDirResult>[3]) => {
        if (generation.current !== fetchGeneration) return;
        setTree((current) => ({ ...current, ...applyDirResult(current, path, seq, outcome) }));
      };
      loadDir(path, refresh).then(
        (response) => apply({ ok: true, entries: response.entries }),
        (error: unknown) => apply({ ok: false, message: commandFailureMessage(error) }),
      );
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
    setTree({ root, ...emptyDirLoads });
    if (root !== null) loadInitial();
  }, [root]);

  const refreshLoaded = useEffectEvent(() => {
    const token = crypto.randomUUID();
    for (const path of refreshPaths(tree)) fetchPath(path, token);
  });

  useEffect(() => {
    if (lastEpoch.current === refreshEpoch) return;
    lastEpoch.current = refreshEpoch;
    if (root !== null) refreshLoaded();
  }, [root, refreshEpoch]);

  const current = tree.root === root;
  return {
    childrenByPath: current ? tree.childrenByPath : emptyDirLoads.childrenByPath,
    errorByPath: current ? tree.errorByPath : emptyDirLoads.errorByPath,
    loadPath,
  };
}
