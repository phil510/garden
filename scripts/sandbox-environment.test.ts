import { describe, expect, it } from 'vitest';
import { loadConfig } from '../packages/server/src/config.js';
import { sandboxEnvironment } from './sandbox-environment.js';

describe('sandbox harness selection', () => {
  const inherited = {
    GARDEN_HARNESS: 'codex',
    GARDEN_PORT: '4310',
    GARDEN_TMUX_SOCKET: 'garden-codex',
    GARDEN_APP_DIR: '/live/garden',
    CODEX_HOME: '/live/codex',
    GARDEN_TRANSCRIPTS_DIR: '/live/transcripts',
    GARDEN_CODEX_COMMAND: 'codex',
    GARDEN_CLAUDE_COMMAND: 'claude',
    GARDEN_SANDBOX_PORT: '54321',
    GARDEN_SANDBOX_SOCKET: 'garden-test-sandbox',
    GARDEN_SANDBOX_APP_DIR: '/isolated/sandbox',
  };

  it.each([[], ['--claude'], ['--codex']])(
    'replaces inherited live-instance settings for %j',
    (...args: string[]) => {
      const env = sandboxEnvironment(args, inherited);
      expect(env).toMatchObject({
        GARDEN_PORT: '54321',
        GARDEN_TMUX_SOCKET: 'garden-test-sandbox',
        GARDEN_APP_DIR: '/isolated/sandbox',
        GARDEN_TRANSCRIPTS_DIR: '/isolated/sandbox/transcripts',
        CODEX_HOME: '/isolated/sandbox/codex-home',
      });
      const codex = args[0] === '--codex';
      expect(env.GARDEN_HARNESS).toBe(codex ? 'codex' : 'claude');
      expect(env[codex ? 'GARDEN_CODEX_COMMAND' : 'GARDEN_CLAUDE_COMMAND']).toContain(
        `scripts/fake-${codex ? 'codex' : 'claude'}.ts`,
      );
      expect(env[codex ? 'GARDEN_CLAUDE_COMMAND' : 'GARDEN_CODEX_COMMAND']).toBeUndefined();
      expect(inherited.CODEX_HOME).toBe('/live/codex');
    },
  );

  it.each(['claude', 'codex'])('keeps the default %s sandbox off both live ports', (harness) => {
    const env = sandboxEnvironment([`--${harness}`], {
      ...inherited,
      GARDEN_SANDBOX_PORT: undefined,
    });
    const livePorts = ['claude', 'codex'].map(
      (liveHarness) => loadConfig({ GARDEN_HARNESS: liveHarness }).port,
    );
    expect(livePorts).not.toContain(Number(env.GARDEN_PORT));
  });

  it.each([['--claude', '--codex'], ['--codex', '--codex'], ['--other']])(
    'rejects ambiguous or unsupported arguments %j',
    (...args: string[]) => {
      expect(() => sandboxEnvironment(args, inherited)).toThrow('Usage:');
    },
  );
});
