import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyRecordedPid,
  isProcessRunning,
  parsePid,
  parsePidRecord,
  readPidFile,
  removePidFile,
  writePidFile,
} from './pid.js';
import type { HealthPidResult } from './serverProcess.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'garden-cli-pid-'));
  path = join(dir, 'server.pid');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parsePid', () => {
  it('parses a positive integer', () => {
    expect(parsePid('1234\n')).toBe(1234);
  });

  it('rejects non-numeric, zero, and negative text', () => {
    expect(parsePid('not a pid')).toBeNull();
    expect(parsePid('0')).toBeNull();
    expect(parsePid('-5')).toBeNull();
  });
});

describe('parsePidRecord', () => {
  it('reads the pid and port', () => {
    expect(parsePidRecord('1234\n7777\n')).toEqual({ pid: 1234, port: 7777 });
  });

  it('reads a pid-only file written before the port was recorded, with no port', () => {
    expect(parsePidRecord('1234\n')).toEqual({ pid: 1234, port: null });
  });

  it('drops an unusable port but keeps the pid', () => {
    expect(parsePidRecord('1234\nabc\n')).toEqual({ pid: 1234, port: null });
    expect(parsePidRecord('1234\n99999\n')).toEqual({ pid: 1234, port: null });
  });

  it('is null when the pid is unusable', () => {
    expect(parsePidRecord('junk\n7777\n')).toBeNull();
  });
});

describe('readPidFile', () => {
  it('returns null when no file has been written', () => {
    expect(readPidFile(path)).toBeNull();
  });

  it('round-trips a written pid and port', () => {
    writePidFile(path, 4242, 7777);
    expect(readPidFile(path)).toEqual({ pid: 4242, port: 7777 });
  });
});

describe('removePidFile', () => {
  it('is a no-op when the file does not exist', () => {
    expect(() => {
      removePidFile(path);
    }).not.toThrow();
  });

  it('deletes a written file', () => {
    writePidFile(path, 1, 7777);
    removePidFile(path);
    expect(readPidFile(path)).toBeNull();
  });
});

describe('isProcessRunning', () => {
  it('reports this process as running', () => {
    expect(isProcessRunning(process.pid)).toBe(true);
  });

  it('reports an exited process as not running', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    const exitedPid = await new Promise<number>((resolve) => {
      const pid = child.pid;
      if (pid === undefined) throw new Error('child process has no pid');
      child.on('exit', () => {
        resolve(pid);
      });
    });
    expect(isProcessRunning(exitedPid)).toBe(false);
  });
});

describe('classifyRecordedPid', () => {
  function classify(pid: number | null, alive: boolean, health: HealthPidResult) {
    const probed: string[] = [];
    const result = classifyRecordedPid(
      pid,
      {
        isProcessRunning: () => alive,
        healthPid: (url) => {
          probed.push(url);
          return Promise.resolve(health);
        },
      },
      'http://h/health',
    );
    return { result, probed };
  }

  it('confirms garden when /health reports the recorded pid', async () => {
    expect(await classify(4242, true, 4242).result).toBe('garden');
  });

  it('is stale when /health reports a different pid', async () => {
    expect(await classify(4242, true, 777).result).toBe('stale');
  });

  it('is stale when nothing is listening', async () => {
    expect(await classify(4242, true, 'refused').result).toBe('stale');
  });

  it('is unresponsive when the process is alive but /health does not answer', async () => {
    expect(await classify(4242, true, 'no-answer').result).toBe('unresponsive');
  });

  it('is stale without probing when the pid is dead or absent', async () => {
    const dead = classify(4242, false, 4242);
    const none = classify(null, true, 4242);

    expect(await dead.result).toBe('stale');
    expect(await none.result).toBe('stale');
    expect(dead.probed).toEqual([]);
    expect(none.probed).toEqual([]);
  });
});
