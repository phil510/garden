// Resolve references from isolated installed packages so checkout siblings cannot hide missing files.
import { cpSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTempDirs, tempDirectory } from './support/temp-directories.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const plugins = join(root, 'plugins');

afterEach(cleanupTempDirs);

function install(name: string): string {
  const destination = join(tempDirectory(), name);
  cpSync(join(plugins, name), destination, { recursive: true });
  return destination;
}

function readReviewer(path: string): void {
  const prompt = readFileSync(path, 'utf8');
  const frontmatter = /^---\n([\s\S]+?)\n---\n/.exec(prompt);
  expect(frontmatter, path).not.toBeNull();
  expect(frontmatter![1]).toMatch(new RegExp(`^name: ${basename(path, '.md')}$`, 'm'));
  expect(prompt.slice(frontmatter![0].length).trim(), path).not.toBe('');
}

describe('plugin packaging', () => {
  it('resolves marketplace entries to their installed plugin identities', () => {
    const marketplace = JSON.parse(
      readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'),
    ) as { plugins: { source: string; name: string }[] };
    for (const entry of marketplace.plugins) {
      const manifest = JSON.parse(
        readFileSync(join(root, entry.source, '.claude-plugin/plugin.json'), 'utf8'),
      ) as { name: string };
      expect(manifest.name).toBe(entry.name);
    }
  });

  it('resolves every Claude review aspect to a registered reviewer in its installed package', () => {
    const installed = install('garden-claude');
    const skill = readFileSync(join(installed, 'skills/review-pr/SKILL.md'), 'utf8');
    const names = [...skill.matchAll(/`garden-claude:([a-z-]+)`/g)].map((match) => match[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of new Set(names)) readReviewer(join(installed, 'agents', `${name}.md`));
  });

  it('resolves every documented Codex review lens from the installed skill directory', () => {
    const installed = install('garden-codex');
    const skillDirectory = join(installed, 'skills/review-pr');
    const skill = readFileSync(join(skillDirectory, 'SKILL.md'), 'utf8');
    const names = [...skill.matchAll(/\|\s+`([a-z-]+\.md)`\s+\|/g)].map((match) => match[1]!);
    const directoryReference = /Prompt under `([^`]+)`/.exec(skill);
    expect(directoryReference).not.toBeNull();
    const promptDirectory = join(skillDirectory, directoryReference![1]!);
    expect(relative(installed, promptDirectory)).not.toMatch(/^\.\./);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) readReviewer(join(promptDirectory, name));
  });
});
