import { homedir } from 'node:os';
import { join } from 'node:path';
import { readClaudeSessionNames } from './adapters/claudeSessions.js';
import { watchFsRoot } from './adapters/fsWatch.js';
import { branch, remoteUrl, repoRoot, status, workTreePrefix } from './adapters/git.js';
import { createLogger, guardStderr, type Logger } from './adapters/logger.js';
import { attachPty } from './adapters/pty.js';
import type { PtyTarget } from './adapters/pty.js';
import { readOverlayState, writeOverlayState } from './adapters/store.js';
import {
  listTranscriptFiles,
  readTranscriptRecord,
  watchTranscripts,
} from './adapters/transcripts.js';
import {
  checkTmuxVersion,
  killSession,
  listPanes,
  newSession,
  respawnPane,
} from './adapters/tmux.js';
import type { TmuxTarget } from './adapters/tmux.js';
import { createAttachRegistry, type AttachRegistry } from './app/attach.js';
import { createBranchSweeper, type BranchSweeper } from './app/branches.js';
import type {
  ConfigPort,
  FsWatchPort,
  GitPort,
  PtyPort,
  StorePort,
  TmuxPaneFact,
  TmuxPort,
  TranscriptPort,
} from './app/ports.js';
import { createPipes } from './app/pipes.js';
import { createProjection, type Projection } from './app/projection.js';
import { createRepoCatalog } from './app/repoCatalog.js';
import { createRootWatches } from './app/rootWatch.js';
import { watchRepoRoots } from './app/repoRoots.js';
import { pruneKnownSessions } from './app/swarms.js';
import { replayWatches } from './app/watches.js';
import { writeClaudeSettings, writeTmuxConf } from './appdir.js';
import {
  appDirPath,
  configFilePath,
  ensureConfigFile,
  loadConfig,
  patchConfigFile,
  readConfigFile,
  resolveClaudeCommand,
  type Config,
} from './config.js';
import type { TmuxSessionFact } from './domain/types.js';
import { createServer } from './http/server.js';

/** How often the tmux poll re-derives liveness. It is the only recurring timer the server has. */
const TMUX_POLL_INTERVAL_MS = 2000;

function tmuxPort(target: TmuxTarget): TmuxPort {
  return {
    listPanes: () => listPanes(target),
    newSession: (request) => newSession(target, request),
    respawnPane: (request) => respawnPane(target, request),
    killSession: (name) => killSession(target, name),
  };
}

function storePort(appDir: string, logger: Logger): StorePort {
  return {
    read: () => readOverlayState(appDir, logger),
    write: (state) => {
      writeOverlayState(appDir, state);
    },
  };
}

/** Binds `config.ts`'s read/write logic to this run's config file path, next to the other
 *  factories that turn a target into a port. */
function configPort(home: string): ConfigPort {
  const path = configFilePath(appDirPath(home, process.env));
  return {
    read: () => readConfigFile(path),
    write: (patch) => {
      patchConfigFile(path, patch);
    },
  };
}

/** Resolves `claudeCommand` fresh from `configPort.read()` on every call, so a command saved
 *  through the settings panel reaches the next spawned or resumed session without a restart —
 *  unlike `permissionMode`, which `main` still reads once from `config` at boot. */
function readClaudeCommand(configPort: ConfigPort): () => readonly string[] {
  return () => resolveClaudeCommand(process.env, configPort.read());
}

function transcriptPort(config: Config, logger: Logger): TranscriptPort {
  return {
    listFiles: () => listTranscriptFiles(config.transcriptsDir, config.roots),
    readRecord: (path) => readTranscriptRecord(path),
    watch: (onEvent) => watchTranscripts(config.transcriptsDir, config.roots, onEvent, logger),
  };
}

function fsWatchPort(logger: Logger): FsWatchPort {
  return { watch: (root, onChange) => watchFsRoot(root, onChange, logger) };
}

function gitPort(): GitPort {
  return { repoRoot, branch, remoteUrl, status, workTreePrefix };
}

function ptyPort(target: PtyTarget): PtyPort {
  return {
    attach: (tmuxName, size, handlers) => attachPty(target, tmuxName, size, handlers),
  };
}

/**
 * tmux lists panes, not sessions. garden gives every session exactly one pane, so the
 * first pane carrying a name is that session's.
 */
function toSessionFacts(panes: readonly TmuxPaneFact[]): TmuxSessionFact[] {
  const facts = new Map<string, TmuxSessionFact>();
  for (const pane of panes) {
    if (facts.has(pane.session)) continue;
    facts.set(pane.session, {
      name: pane.session,
      paneDead: pane.dead,
      exitCode: pane.exitCode ?? null,
    });
  }
  return [...facts.values()];
}

async function dispatchTmuxSnapshot(projection: Projection, tmux: TmuxPort): Promise<void> {
  projection.dispatch({ type: 'tmux-snapshot', sessions: toSessionFacts(await tmux.listPanes()) });
}

async function dispatchClaudeSessionNames(
  projection: Projection,
  sessionsDir: string,
  logger: Logger,
): Promise<void> {
  const { names, skipped } = await readClaudeSessionNames(sessionsDir);
  if (skipped > 0) {
    logger.warn(`skipped ${String(skipped)} unreadable registry file(s) in ${sessionsDir}`);
  }
  projection.dispatch({ type: 'claude-session-names-loaded', names });
}

/**
 * Boot is a replay rather than a restore: the store contributes only the overlay facts
 * garden cannot recompute, and every session fact is re-derived from the events the
 * adapters would emit anyway. That is why there is no reconciliation path.
 */
async function replay(
  projection: Projection,
  store: StorePort,
  tmux: TmuxPort,
  transcripts: TranscriptPort,
  branches: BranchSweeper,
  logger: Logger,
  claudeSessionsDir: string,
  git: GitPort,
): Promise<void> {
  projection.dispatch({ type: 'store-loaded', tmuxNames: { ...store.read().tmuxNames } });
  // Isolated like the steps below: unreadable watch state is not a reason to fail boot.
  try {
    replayWatches({ projection, git }, Date.now());
  } catch (error) {
    logger.error(`watch replay failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await dispatchTmuxSnapshot(projection, tmux);
  try {
    // Same boundary as the poll tick's own try/catch: a registry read failure is a missing
    // display name, not a reason to fail boot.
    await dispatchClaudeSessionNames(projection, claudeSessionsDir, logger);
  } catch (error) {
    logger.error(
      `claude session registry read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const path of await transcripts.listFiles()) {
    try {
      const { record, skipped } = await transcripts.readRecord(path);
      if (skipped > 0) logger.warn(`skipped ${String(skipped)} unparseable line(s) in ${path}`);
      projection.dispatch({ type: 'transcript-changed', path, record });
    } catch (error) {
      // One unreadable transcript is a session garden cannot describe, not a failed boot.
      logger.error(`failed to read transcript ${path}: ${(error as Error).message}`);
    }
  }
  // After the transcript loop, not alongside the dispatches above: sessions' cwds don't exist
  // in state until that loop has run. tick() resolves per-cwd git failures to null rather than
  // rejecting; this guards boot itself against an unexpected throw, matching the sibling calls'
  // isolation above rather than catching a failure mode tick() is actually expected to produce.
  try {
    await branches.tick();
  } catch (error) {
    logger.error(`branch sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The composition root: the one place that reads config and wires the parts together.
 *  `detached` distinguishes `garden`'s own detached background server from `main()` running
 *  attached to a developer's terminal (`pnpm dev` / `pnpm dev:sandbox`) — see
 *  `SERVER_DETACHED_FLAG` in `cli/start.ts`. */
export async function main(detached: boolean): Promise<void> {
  await checkTmuxVersion();

  const home = homedir();
  const logger = createLogger();
  // Armed before anything can log: it backstops the whole process lifetime, including the
  // pre-redirect window below, in case that pipe closes early too.
  guardStderr();
  const config = loadConfig(process.env, ensureConfigFile(home, logger), home);
  const confPath = writeTmuxConf(config.appDir);
  const settingsPath = writeClaudeSettings(config.appDir);

  const store = storePort(config.appDir, logger);
  const configAdapter = configPort(home);
  const tmux = tmuxPort({ socket: config.tmuxSocket, confPath });
  const transcripts = transcriptPort(config, logger);
  const git = gitPort();
  const projection = createProjection(store);
  const pipes = createPipes({ projection, git });
  const attach: AttachRegistry = createAttachRegistry({
    pty: ptyPort({ socket: config.tmuxSocket, confPath }),
    projection,
  });

  // Subscribed before the replay so boot's own dispatches are what drive the first resolutions.
  const stopRepoRoots = watchRepoRoots({ git, projection });
  const branches = createBranchSweeper({ git, projection });

  // Started before replay() rather than after — including before its store-loaded and
  // tmux-snapshot dispatches, not just before its transcript scan — so a write landing
  // anywhere in that window still reaches the watch instead of being lost until the next
  // unrelated event or a restart. The watcher's own initial scan dispatches nothing
  // (ignoreInitial), so this only affects files written during boot, not the existing corpus.
  const watcher = transcripts.watch((event) => {
    projection.dispatch(event);
  });

  await replay(
    projection,
    store,
    tmux,
    transcripts,
    branches,
    logger,
    config.claudeSessionsDir,
    git,
  );
  // Only valid once replay's transcript scan has settled what "known" means — any earlier
  // (store-loaded, or the first tmux snapshot) would prune a live child whose transcript
  // just hasn't been read yet. Isolated like every other boot step above: a stale overlay
  // entry left behind by a failed prune is not a reason to fail boot.
  try {
    pruneKnownSessions({ projection });
  } catch (error) {
    logger.error(
      `post-boot pruning failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const poll = setInterval(() => {
    // A tmux that fails mid-run leaves liveness stale until the next tick; it does not end the server.
    dispatchTmuxSnapshot(projection, tmux).catch((error: unknown) => {
      logger.error(`tmux poll failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    // Its own try/catch, not chained onto the tmux snapshot's promise: a registry read
    // failure must not swallow that tick's liveness dispatch.
    dispatchClaudeSessionNames(projection, config.claudeSessionsDir, logger).catch(
      (error: unknown) => {
        logger.error(
          `claude session registry poll failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
    // Its own catch too, for the same reason as above — see replay()'s comment on what this
    // actually guards, since tick() resolves per-cwd git failures internally rather than rejecting.
    branches.tick().catch((error: unknown) => {
      logger.error(
        `branch sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, TMUX_POLL_INTERVAL_MS);

  const repos = createRepoCatalog({ git, roots: config.roots });
  const app = createServer(
    {
      projection,
      pipes,
      tmux,
      store,
      git,
      attach,
      repos,
      rootWatches: createRootWatches({ watcher: fsWatchPort(logger), repos, logger }),
      serverPort: config.port,
      settingsPath,
      readClaudeCommand: readClaudeCommand(configAdapter),
      permissionMode: config.permissionMode,
      deadSessionCap: config.deadSessionCap,
      terminalFontSize: config.terminalFontSize,
      configPort: configAdapter,
    },
    logger,
  );
  app.addHook('onClose', () => {
    clearInterval(poll);
    stopRepoRoots();
    branches.stop();
    return watcher.close();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.close());
  }

  await app.listen({ port: config.port, host: config.host });
  if (detached) {
    // Earliest the health endpoint can answer 'ok' — the earliest spawnServer's poll loop can
    // observe readiness and exit, closing its end of the stderr pipe. Nothing should log through
    // the console sink after this point. Skipped when running attached (`pnpm dev` /
    // `pnpm dev:sandbox`), where the console is exactly where this should go.
    logger.redirectToFile(join(config.appDir, 'server.log'));
  }
  logger.info(`garden listening on http://${config.host}:${String(config.port)}`);
}
