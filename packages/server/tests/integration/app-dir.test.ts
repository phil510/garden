import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureConfigFile } from '../../src/config.js';

function withTempHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'garden-home-'));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('ensureConfigFile', () => {
  it('creates the app directory and a default config.json on first run', () => {
    withTempHome((home) => {
      expect(ensureConfigFile(home).port).toBe(4310);
      const written = readFileSync(join(home, '.garden', 'config.json'), 'utf8');
      expect(JSON.parse(written)).toEqual({ port: 4310, roots: ['~/Desktop/Extend'] });
    });
  });

  it('reads an existing config.json instead of overwriting it', () => {
    withTempHome((home) => {
      ensureConfigFile(home);
      const path = join(home, '.garden', 'config.json');
      writeFileSync(path, '{"port": 4999, "roots": ["/srv/code"]}', 'utf8');
      expect(ensureConfigFile(home)).toEqual({ port: 4999, roots: ['/srv/code'] });
      expect(readFileSync(path, 'utf8')).toContain('4999');
    });
  });

  it('fails with a message naming the file when config.json is malformed', () => {
    withTempHome((home) => {
      ensureConfigFile(home);
      writeFileSync(join(home, '.garden', 'config.json'), '{ nope', 'utf8');
      expect(() => ensureConfigFile(home)).toThrow(/config\.json is not valid JSON/);
    });
  });
});
