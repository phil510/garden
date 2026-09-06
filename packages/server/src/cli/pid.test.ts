import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isProcessRunning, parsePid, readPidFile, removePidFile, writePidFile } from './pid.js';

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

describe('readPidFile', () => {
  it('returns null when no file has been written', () => {
    expect(readPidFile(path)).toBeNull();
  });

  it('round-trips a written pid', () => {
    writePidFile(path, 4242);
    expect(readPidFile(path)).toBe(4242);
  });
});

describe('removePidFile', () => {
  it('is a no-op when the file does not exist', () => {
    expect(() => {
      removePidFile(path);
    }).not.toThrow();
  });

  it('deletes a written file', () => {
    writePidFile(path, 1);
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
