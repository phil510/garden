// Exercises plugins/garden/monitors/events.sh as a real subprocess — see docs/testing.md for why
// the plugin scripts are never run through a mocked execFile.
import { spawn } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTempDirs, EVENTS_MONITOR_SH, tempScratchpad } from './support/plugin-hooks.js';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A `garden` on PATH that records its argv and GARDEN_SESSION_ID instead of connecting. */
function stubGarden(dir: string): string {
  const record = join(dir, 'garden-invocation');
  const stub = join(dir, 'garden');
  writeFileSync(stub, `#!/bin/sh\necho "$@ $GARDEN_SESSION_ID" > "${record}"\n`);
  chmodSync(stub, 0o755);
  return record;
}

const cleanups: Array<() => void> = [];

describe('plugins/garden/monitors/events.sh', () => {
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    cleanupTempDirs();
  });

  it('blocks silently without running garden outside a garden session, and ends when Claude does', async () => {
    const dir = tempScratchpad();
    const record = stubGarden(dir);
    const claude = spawn('sleep', ['60']);
    cleanups.push(() => claude.kill());
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CLAUDE_PID: String(claude.pid),
    };
    delete env.GARDEN_SESSION_ID;

    const monitor = spawn(EVENTS_MONITOR_SH, [], { env });
    cleanups.push(() => monitor.kill());
    let stdout = '';
    monitor.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => monitor.on('exit', resolve));

    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(isAlive(monitor.pid as number)).toBe(true);

    claude.kill();
    expect(await exited).toBe(0);
    expect(stdout).toBe('');
    expect(() => readFileSync(record)).toThrow();
  }, 20_000);

  it('execs garden events --follow with the session environment inside a garden session', async () => {
    const dir = tempScratchpad();
    const record = stubGarden(dir);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GARDEN_SESSION_ID: 'sess-1' };

    const monitor = spawn(EVENTS_MONITOR_SH, [], { env });
    cleanups.push(() => monitor.kill());
    await new Promise((resolve) => monitor.on('exit', resolve));

    await until(() => readFileSync(record, 'utf8').length > 0);
    expect(readFileSync(record, 'utf8').trim()).toBe('events --follow sess-1');
  });
});
