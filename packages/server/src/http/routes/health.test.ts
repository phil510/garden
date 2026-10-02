import { describe, expect, it } from 'vitest';
import type { Projection } from '../../app/projection.js';
import type { ServerDeps } from '../server.js';
import { createServer } from '../server.js';

function fakeProjection(): Projection {
  return {
    sessions: () => [],
    uiState: () => {
      throw new Error('not used by this test');
    },
    dispatch: () => undefined,
    updateUiState: () => {
      throw new Error('not used by this test');
    },
    subscribe: () => () => undefined,
    subscribeUiState: () => () => undefined,
    updateOverlay: () => {
      throw new Error('not used by this test');
    },
    placementOf: () => {
      throw new Error('not used by this test');
    },
  };
}

function fakeDeps(): ServerDeps {
  return {
    projection: fakeProjection(),
    rootWatches: { connect: () => ({ watch: () => Promise.resolve(), close: () => undefined }) },
    tmux: {
      listPanes: () => Promise.reject(new Error('not used by this test')),
      newSession: () => Promise.reject(new Error('not used by this test')),
      respawnPane: () => Promise.reject(new Error('not used by this test')),
      killSession: () => Promise.reject(new Error('not used by this test')),
    },
    store: {
      read: () => {
        throw new Error('not used by this test');
      },
      write: () => {
        throw new Error('not used by this test');
      },
    },
    configPort: {
      read: () => {
        throw new Error('not used by this test');
      },
      write: () => {
        throw new Error('not used by this test');
      },
    },
    git: {
      status: () => Promise.reject(new Error('not used by this test')),
      workTreePrefix: () => Promise.reject(new Error('not used by this test')),
    },
    attach: {
      attach: () => {
        throw new Error('not used by this test');
      },
    },
    repos: {
      list: () => Promise.resolve([]),
      resolveRoot: () => Promise.reject(new Error('not used by this test')),
    },
    serverPort: 4310,
    settingsPath: '/home/.garden/claude-settings.json',
    readClaudeCommand: () => ['claude'],
    deadSessionCap: 10,
    terminalFontSize: 13,
  };
}

describe('GET /health', () => {
  it('is mounted and answers 200 with an ok status', async () => {
    const app = createServer(fakeDeps());
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
