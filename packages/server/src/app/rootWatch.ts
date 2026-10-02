import type { FsWatch, FsWatchPort, Logger } from './ports.js';
import { RootNotListedError, type RepoCatalog } from './repoCatalog.js';

export interface RootWatchDeps {
  readonly watcher: FsWatchPort;
  readonly repos: Pick<RepoCatalog, 'resolveRoot'>;
  readonly logger: Logger;
}

/** One `/events` connection's view of the filesystem: at most one watched root at a time. */
export interface RootWatchConnection {
  /** Replaces the current watch with one on `root`. Never rejects: an unlisted or vanished
   *  root just leaves the connection with no watch. */
  watch(root: string): Promise<void>;
  /** Releases the current watch and ignores any `watch` still resolving. */
  close(): void;
}

export interface RootWatches {
  /** `onChange` receives the root exactly as the client spelled it in `watch`. */
  connect(onChange: (root: string) => void): RootWatchConnection;
}

export function createRootWatches({ watcher, repos, logger }: RootWatchDeps): RootWatches {
  return {
    connect(onChange) {
      let current: FsWatch | undefined;
      let generation = 0;
      let closed = false;

      const release = () => {
        current?.close();
        current = undefined;
      };

      return {
        async watch(root) {
          generation += 1;
          const mine = generation;
          release();
          let resolved: string;
          try {
            resolved = await repos.resolveRoot(root);
          } catch (error) {
            if (!(error instanceof RootNotListedError)) {
              logger.warn(
                `could not resolve ${root}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
            return;
          }
          if (closed || mine !== generation) return;
          try {
            current = watcher.watch(resolved, () => onChange(root));
          } catch (error) {
            logger.warn(
              `could not watch ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
        close() {
          closed = true;
          release();
        },
      };
    },
  };
}
