import { homedir } from 'node:os';
import { branch, repoInfo, repoRoot, status, workTreePrefix } from './adapters/git.js';
import { createLogger, type Logger } from './adapters/logger.js';
import { attachPty } from './adapters/pty.js';
import type { PtyTarget } from './adapters/pty.js';
import { readOverlayState, writeOverlayState } from './adapters/store.js';
import {
  listTranscriptFiles,
  readTranscriptRecord,
  watchTranscripts,
} from './adapters/transcripts.js';
import { killSession, listPanes, newSession, respawnPane } from './adapters/tmux.js';
import type { TmuxTarget } from './adapters/tmux.js';
import { createAttachRegistry, type AttachRegistry } from './app/attach.js';
import type {
  GitPort,
  PtyPort,
  StorePort,
  TmuxPaneFact,
  TmuxPort,
  TranscriptPort,
} from './app/ports.js';
import { createProjection, type Projection } from './app/projection.js';
import { watchRepoInfo } from './app/repoInfo.js';
import { writeClaudeSettings, writeTmuxConf } from './appdir.js';
import { ensureConfigFile, loadConfig, type Config } from './config.js';
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

function transcriptPort(config: Config, logger: Logger): TranscriptPort {
  return {
    listFiles: () => listTranscriptFiles(config.transcriptsDir, config.roots),
    readRecord: (path) => readTranscriptRecord(path),
    watch: (onEvent) => watchTranscripts(config.transcriptsDir, config.roots, onEvent, logger),
  };
}

function gitPort(): GitPort {
  return { repoRoot, branch, status, workTreePrefix, repoInfo };
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
  logger: Logger,
): Promise<void> {
  projection.dispatch({ type: 'store-loaded', tmuxNames: { ...store.read().tmuxNames } });
  await dispatchTmuxSnapshot(projection, tmux);
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
}

/** The composition root: the one place that reads config and wires the parts together. */
export async function main(): Promise<void> {
  const home = homedir();
  const config = loadConfig(process.env, ensureConfigFile(home), home);
  const confPath = writeTmuxConf(config.appDir);
  const settingsPath = writeClaudeSettings(config.appDir);

  const logger = createLogger();
  const store = storePort(config.appDir, logger);
  const tmux = tmuxPort({ socket: config.tmuxSocket, confPath });
  const transcripts = transcriptPort(config, logger);
  const git = gitPort();
  const projection = createProjection(store);
  const attach: AttachRegistry = createAttachRegistry({
    pty: ptyPort({ socket: config.tmuxSocket, confPath }),
    projection,
  });

  // Subscribed before the replay so boot's own dispatches are what drive the first resolutions.
  const stopRepoInfo = watchRepoInfo({ git, projection });

  await replay(projection, store, tmux, transcripts, logger);

  const watcher = transcripts.watch((event) => {
    projection.dispatch(event);
  });
  const poll = setInterval(() => {
    // A tmux that fails mid-run leaves liveness stale until the next tick; it does not end the server.
    dispatchTmuxSnapshot(projection, tmux).catch((error: unknown) => {
      logger.error(`tmux poll failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, TMUX_POLL_INTERVAL_MS);

  const app = createServer({
    projection,
    tmux,
    store,
    git,
    attach,
    roots: config.roots,
    serverPort: config.port,
    settingsPath,
    claudeCommand: config.claudeCommand,
  });
  app.addHook('onClose', () => {
    clearInterval(poll);
    stopRepoInfo();
    return watcher.close();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.close());
  }

  await app.listen({ port: config.port, host: config.host });
  logger.info(`garden listening on http://${config.host}:${String(config.port)}`);
}
