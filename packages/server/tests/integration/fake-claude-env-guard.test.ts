// scripts/fake-claude.ts refuses to run unless GARDEN_PORT and GARDEN_TRANSCRIPTS_DIR are both
// set, because a defaulted value would point a stray pane at the developer's real garden on
// port 4310 and litter their actual ~/.claude/projects. The guard (`requiredEnv`) is
// module-private by design, so it is proven here as a black box: a real `tsx` process spawned
// with a controlled environment, asserting on its exit code and stderr rather than calling the
// function directly.
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const TSX = join(repoRoot, 'node_modules', '.bin', 'tsx');
const FAKE_CLAUDE = join(repoRoot, 'scripts', 'fake-claude.ts');

/**
 * Only what `tsx` needs to resolve and start node. Deliberately not `{ ...process.env }`: this
 * repo's own dev/test environment may well have GARDEN_PORT or GARDEN_TRANSCRIPTS_DIR set (a
 * developer running this suite from inside a garden session would), and spreading it would let
 * the ambient environment silently satisfy the guard this test exists to pin.
 */
function isolatedEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR']) {
    const value = process.env[key];
    if (value !== undefined) inherited[key] = value;
  }
  return { ...inherited, ...overrides };
}

async function spawnFakeClaude(
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(TSX, [FAKE_CLAUDE], { env });
    return { code: 0, stderr };
  } catch (error) {
    const failure = error as { code?: number | null; stderr?: string };
    return { code: failure.code ?? null, stderr: failure.stderr ?? '' };
  }
}

describe('fake-claude refusing to start without its isolation env vars', () => {
  it.each([
    ['unset', {}],
    ['blank', { GARDEN_PORT: '' }],
  ] as const)('exits 1 naming GARDEN_PORT when it is %s', async (_case, overrides) => {
    const { code, stderr } = await spawnFakeClaude(isolatedEnv(overrides));

    expect(code).toBe(1);
    expect(stderr).toContain('GARDEN_PORT');
  });

  it.each([
    ['unset', { GARDEN_PORT: '4999' }],
    ['blank', { GARDEN_PORT: '4999', GARDEN_TRANSCRIPTS_DIR: '' }],
  ] as const)('exits 1 naming GARDEN_TRANSCRIPTS_DIR when it is %s', async (_case, overrides) => {
    const { code, stderr } = await spawnFakeClaude(isolatedEnv(overrides));

    expect(code).toBe(1);
    expect(stderr).toContain('GARDEN_TRANSCRIPTS_DIR');
  });
});
