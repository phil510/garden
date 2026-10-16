import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reap, record, stopFor, type RegistryDeps } from './screenshot-registry.js';

interface FakeWorld {
  deps: RegistryDeps;
  killed: number[];
}

/** `groups` maps a pgid to the command lines alive in it; `gone` are checkouts that were removed. */
function fakeWorld(groups: Record<number, string[]>, gone: string[] = []): FakeWorld {
  const killed: number[] = [];
  return {
    killed,
    deps: {
      kill: (pid) => {
        killed.push(-pid);
        if (groups[-pid] === undefined) {
          throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
        }
      },
      exists: (path) => !gone.includes(path),
      groupCommands: (pgid) => groups[pgid] ?? [],
    },
  };
}

const viteCommand = (port: number) => `node vite --host 127.0.0.1 --port ${String(port)}`;

describe('screenshot vite registry', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'screenshot-registry-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reaps only entries whose checkout is gone', () => {
    record(dir, { pgid: 100, repoRoot: '/wt/gone', port: 5201 });
    record(dir, { pgid: 200, repoRoot: '/wt/live', port: 5202 });
    const { deps, killed } = fakeWorld({ 100: [viteCommand(5201)], 200: [viteCommand(5202)] }, [
      '/wt/gone',
    ]);

    expect(reap(dir, deps).map((e) => e.pgid)).toEqual([100]);
    expect(killed).toEqual([100]);
    expect(readdirSync(dir)).toEqual(['200.json']);
  });

  it('drops an entry whose group is already gone without error', () => {
    record(dir, { pgid: 100, repoRoot: '/wt/gone', port: 5201 });
    const { deps, killed } = fakeWorld({}, ['/wt/gone']);

    expect(reap(dir, deps)).toEqual([]);
    expect(killed).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('does not signal a reused pgid that no longer runs this entry vite', () => {
    record(dir, { pgid: 100, repoRoot: '/wt/gone', port: 5201 });
    const { deps, killed } = fakeWorld({ 100: ['/usr/bin/some-stranger --flag'] }, ['/wt/gone']);

    expect(reap(dir, deps)).toEqual([]);
    expect(killed).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('still kills a group whose leader died but whose vite lives on', () => {
    record(dir, { pgid: 100, repoRoot: '/wt/gone', port: 5201 });
    const { deps, killed } = fakeWorld({ 100: [viteCommand(5201)] }, ['/wt/gone']);

    expect(reap(dir, deps)).toHaveLength(1);
    expect(killed).toEqual([100]);
  });

  it('tolerates ESRCH from the kill itself', () => {
    record(dir, { pgid: 100, repoRoot: '/wt/gone', port: 5201 });
    const { deps } = fakeWorld({ 100: [viteCommand(5201)] }, ['/wt/gone']);
    deps.kill = () => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    };

    expect(reap(dir, deps)).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('deletes unreadable entry files', () => {
    writeFileSync(join(dir, '7.json'), 'not json');
    writeFileSync(join(dir, '8.json'), JSON.stringify({ pgid: 'x' }));

    reap(dir, fakeWorld({}).deps);

    expect(readdirSync(dir)).toEqual([]);
  });

  it('stopFor stops every port of one checkout and none of another', () => {
    record(dir, { pgid: 100, repoRoot: '/wt/a', port: 5201 });
    record(dir, { pgid: 101, repoRoot: '/wt/a', port: 5202 });
    record(dir, { pgid: 200, repoRoot: '/wt/b', port: 5203 });
    const { deps, killed } = fakeWorld({
      100: [viteCommand(5201)],
      101: [viteCommand(5202)],
      200: [viteCommand(5203)],
    });

    expect(stopFor(dir, '/wt/a', deps)).toHaveLength(2);
    expect(killed.sort()).toEqual([100, 101]);
    expect(existsSync(join(dir, '200.json'))).toBe(true);
    expect(readdirSync(dir)).toEqual(['200.json']);
  });

  it('is a no-op when the registry directory does not exist', () => {
    expect(reap(join(dir, 'missing'), fakeWorld({}).deps)).toEqual([]);
    expect(stopFor(join(dir, 'missing'), '/wt/a', fakeWorld({}).deps)).toEqual([]);
  });
});
