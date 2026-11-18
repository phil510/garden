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
  it.each([
    ['.claude-plugin/marketplace.json', 'garden-claude'],
    ['.agents/plugins/marketplace.json', 'garden-codex'],
  ])('resolves %s to only the matching installed plugin', (catalog, identity) => {
    const marketplace = JSON.parse(readFileSync(join(root, catalog), 'utf8')) as {
      name: string;
      plugins: { source: string; name: string }[];
    };
    expect(marketplace.name).toBe('garden');
    expect(marketplace.plugins.map((entry) => entry.name)).toEqual([identity]);
    for (const entry of marketplace.plugins) {
      const installed = join(tempDirectory(), entry.name);
      cpSync(join(root, entry.source), installed, { recursive: true });
      const manifest = JSON.parse(
        readFileSync(join(installed, '.claude-plugin/plugin.json'), 'utf8'),
      ) as { name: string };
      expect(manifest.name).toBe(entry.name);
    }
  });

  it('resolves Claude ship-it reviewer types in its installed package', () => {
    const installed = install('garden-claude');
    const reviewer = readFileSync(join(installed, 'agents/ship-it-reviewer.md'), 'utf8');
    const names = [...reviewer.matchAll(/`garden-claude:([a-z-]+)`/g)].map((match) => match[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of new Set(names)) readReviewer(join(installed, 'agents', `${name}.md`));
  });

  it('resolves Codex ship-it reviewer prompts from the installed skill directory', () => {
    const installed = install('garden-codex');
    const skillDirectory = join(installed, 'skills/ship-it');
    const reviewer = readFileSync(
      join(skillDirectory, 'references/roles/ship-it-reviewer.md'),
      'utf8',
    );
    const slots = /- \*\*Slot 1\b([\s\S]+?)\*\*Scaling\.\*\*/.exec(reviewer);
    expect(slots).not.toBeNull();
    const names = [...slots![1]!.matchAll(/`([a-z-]+\.md)`/g)].map((match) => match[1]!);
    const directoryReference = /`\$\{SKILLDIR\}\/([^`]+)\/<role>\.md`/.exec(reviewer);
    expect(directoryReference).not.toBeNull();
    const promptDirectory = join(skillDirectory, directoryReference![1]!);
    expect(relative(installed, promptDirectory)).not.toMatch(/^\.\./);
    expect(names.length).toBeGreaterThan(0);
    for (const name of new Set(names)) readReviewer(join(promptDirectory, name));
  });
});
