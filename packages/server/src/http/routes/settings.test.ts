import { describe, expect, it } from 'vitest';
import type { Projection } from '../../app/projection.js';
import type { ConfigPort } from '../../app/ports.js';
import { ConfigWriteRefusedError } from '../../app/ports.js';
import { DEFAULT_CONFIG_FILE } from '../../config.js';
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

function fakeConfigPort(overrides: Partial<ConfigPort> = {}): ConfigPort {
  return {
    read: () => ({ ...DEFAULT_CONFIG_FILE, claudeCommand: 'claude' }),
    write: () => {
      throw new Error('not used by this test');
    },
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
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
    configPort: fakeConfigPort(),
    git: {
      status: () => Promise.reject(new Error('not used by this test')),
      workTreePrefix: () => Promise.reject(new Error('not used by this test')),
      remoteUrl: () => Promise.reject(new Error('not used by this test')),
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
    deadSessionCap: 25,
    terminalFontSize: 18,
    ...overrides,
  };
}

describe('GET /settings', () => {
  it('is mounted and answers 200 with the injected settings, including the live claudeCommand', async () => {
    const app = createServer(
      fakeDeps({
        configPort: fakeConfigPort({
          read: () => ({ ...DEFAULT_CONFIG_FILE, claudeCommand: 'ec bedrock launch claude --' }),
        }),
      }),
    );
    try {
      const response = await app.inject({ method: 'GET', url: '/settings' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        deadSessionCap: 25,
        terminalFontSize: 18,
        claudeCommand: 'ec bedrock launch claude --',
        ignoreAuthors: [],
        quietWindowMinutes: 3,
        pollIntervalMinutes: 5,
      });
    } finally {
      await app.close();
    }
  });
});

describe('PUT /settings', () => {
  it('answers 400 on a body without a string claudeCommand', async () => {
    const app = createServer(fakeDeps());
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { claudeCommand: 42 },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('answers 400, not 500, on a blank claudeCommand', async () => {
    const app = createServer(fakeDeps());
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { claudeCommand: '   ' },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('answers 200 and writes the patch through the config port on success', async () => {
    const written: unknown[] = [];
    const app = createServer(
      fakeDeps({
        configPort: fakeConfigPort({
          write: (patch) => {
            written.push(patch);
          },
        }),
      }),
    );
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { claudeCommand: 'tsx scripts/fake-claude.ts' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(written).toEqual([{ claudeCommand: 'tsx scripts/fake-claude.ts' }]);
    } finally {
      await app.close();
    }
  });

  it('answers 409 when the config port refuses the write', async () => {
    const app = createServer(
      fakeDeps({
        configPort: fakeConfigPort({
          write: () => {
            throw new ConfigWriteRefusedError('existing file is invalid');
          },
        }),
      }),
    );
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { claudeCommand: 'claude' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: 'existing file is invalid' });
    } finally {
      await app.close();
    }
  });
});
