import { homedir } from 'node:os';
import { createLogger, type Logger } from './adapters/logger.js';
import { readOverlayState, writeOverlayState } from './adapters/store.js';
import {
  listTranscriptFiles,
  readTranscriptRecord,
  watchTranscripts,
} from './adapters/transcripts.js';
import { killSession, listPanes, newSession, respawnPane } from './adapters/tmux.js';
import type { TmuxTarget } from './adapters/tmux.js';
import type { StorePort, TmuxPaneFact, TmuxPort, TranscriptPort } from './app/ports.js';
import { createProjection, type Projection } from './app/projection.js';
import { writeClaudeSettings, writeTmuxConf } from './appdir.js';
import { ensureConfigFile, loadConfig, type Config } from './config.js';
import type { TmuxSessionFact } from './domain/types.js';
import { createServer } from './http/server.js';

/** Every garden tmux session lives on this socket, so `tmux -L garden` reaches them
 *  and nothing garden does can disturb a user's own tmux server. */
const TMUX_SOCKET = 'garden';

function tmuxPort(target: TmuxTarget): TmuxPort {
  return {
    listPanes: () => listPanes(target),
    newSession: (request) => newSession(target, request),
    respawnPane: (request) => respawnPane(target, request),
    killSession: (name) => killSession(target, name),
  };
}

function storePort(home: string, logger: Logger): StorePort {
  return {
    read: () => readOverlayState(home, logger),
    write: (state) => {
      writeOverlayState(home, state);
    },
  };
}

function transcriptPort(config: Config, home: string, logger: Logger): TranscriptPort {
  return {
    listFiles: () => listTranscriptFiles(home, config.roots),
    readRecord: (path) => readTranscriptRecord(path),
    watch: (onEvent) => watchTranscripts(home, config.roots, onEvent, logger),
  };
}

/**
 * tmux lists panes, not sessions. garden gives every session exactly one pane, so the
 * first pane carrying a name is that session's; a pane list carries no attach state,
 * which is the attach registry's business rather than a fact about the session.
 */
function toSessionFacts(panes: readonly TmuxPaneFact[]): TmuxSessionFact[] {
  const facts = new Map<string, TmuxSessionFact>();
  for (const pane of panes) {
    if (facts.has(pane.session)) continue;
    facts.set(pane.session, {
      name: pane.session,
      paneDead: pane.dead,
      exitCode: pane.exitCode ?? null,
      attached: false,
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
  const confPath = writeTmuxConf(home);
  writeClaudeSettings(home);

  const logger = createLogger();
  const store = storePort(home, logger);
  const tmux = tmuxPort({ socket: TMUX_SOCKET, confPath });
  const transcripts = transcriptPort(config, home, logger);
  const projection = createProjection(store);

  await replay(projection, store, tmux, transcripts, logger);

  const watcher = transcripts.watch((event) => {
    projection.dispatch(event);
  });

  const app = createServer();
  app.addHook('onClose', () => watcher.close());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.close());
  }

  await app.listen({ port: config.port, host: config.host });
  logger.info(`garden listening on http://${config.host}:${String(config.port)}`);
}
