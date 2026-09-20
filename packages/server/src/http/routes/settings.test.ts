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
  };
}

function fakeDeps(): ServerDeps {
  return {
    projection: fakeProjection(),
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
    git: {
      repoRoot: () => Promise.reject(new Error('not used by this test')),
      branch: () => Promise.reject(new Error('not used by this test')),
      status: () => Promise.reject(new Error('not used by this test')),
      workTreePrefix: () => Promise.reject(new Error('not used by this test')),
    },
    attach: {
      attach: () => {
        throw new Error('not used by this test');
      },
    },
    roots: [],
    serverPort: 4310,
    settingsPath: '/home/.garden/claude-settings.json',
    claudeCommand: ['claude'],
    deadSessionCap: 25,
    terminalFontSize: 18,
  };
}

describe('GET /settings', () => {
  it('is mounted and answers 200 with the injected settings', async () => {
    const app = createServer(fakeDeps());
    try {
      const response = await app.inject({ method: 'GET', url: '/settings' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ deadSessionCap: 25, terminalFontSize: 18 });
    } finally {
      await app.close();
    }
  });
});
