import { useEffect } from 'react';
import { usePipeGraceStore } from '../../state/pipeGraceStore';
import { useSessionStore } from '../../state/sessionStore';
import { nextGraceExpiry, pipeFaultedIds, trackPipeDown, type DownSince } from './pipeGrace';

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/** Mount once. Keeps `pipeGraceStore` in step with the sessions' pipe state, waking itself
 *  when the next disconnected session crosses its grace period. */
export function usePipeGrace(): void {
  useEffect(() => {
    let downSince: DownSince = {};
    let timer: ReturnType<typeof setTimeout> | undefined;

    function recompute() {
      clearTimeout(timer);
      const now = Date.now();
      downSince = trackPipeDown(downSince, Object.values(useSessionStore.getState().sessions), now);
      const faulted = pipeFaultedIds(downSince, now);
      if (!sameIds(faulted, usePipeGraceStore.getState().faulted)) {
        usePipeGraceStore.getState().setFaulted(faulted);
      }
      const expiry = nextGraceExpiry(downSince, now);
      if (expiry !== null) timer = setTimeout(recompute, expiry - now);
    }

    recompute();
    const unsubscribe = useSessionStore.subscribe(recompute);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);
}
