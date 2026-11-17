import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const plugins = join(root, 'plugins');

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
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

  it('preserves the complete pinned upstream toolkit in both independently installed packages', () => {
    const claude = join(plugins, 'garden-claude/vendor/pr-review-toolkit');
    const codex = join(plugins, 'garden-codex/vendor/pr-review-toolkit');
    const checksums = readFileSync(`${claude}.sha256`, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('  ') as [string, string]);
    expect(readFileSync(`${codex}.sha256`, 'utf8')).toBe(readFileSync(`${claude}.sha256`, 'utf8'));
    for (const directory of [claude, codex]) {
      expect(
        filesUnder(directory)
          .map((path) => relative(directory, path))
          .sort(),
      ).toEqual(checksums.map(([, path]) => path).sort());
      for (const [hash, path] of checksums) {
        expect(
          createHash('sha256')
            .update(readFileSync(join(directory, path)))
            .digest('hex'),
        ).toBe(hash);
      }
    }
  });

  it('registers the upstream Claude reviewers without changing their prompts', () => {
    const upstream = join(plugins, 'garden-claude/vendor/pr-review-toolkit/agents');
    for (const name of readdirSync(upstream)) {
      expect(readFileSync(join(plugins, 'garden-claude/agents', name))).toEqual(
        readFileSync(join(upstream, name)),
      );
    }
  });

  it('resolves every documented Codex review lens from the installed skill directory', () => {
    const skillDirectory = join(plugins, 'garden-codex/skills/review-pr');
    const skill = readFileSync(join(skillDirectory, 'SKILL.md'), 'utf8');
    const names = [...skill.matchAll(/\|\s+`([a-z-]+\.md)`\s+\|/g)].map((match) => match[1]!);
    const promptDirectory = join(skillDirectory, '../../vendor/pr-review-toolkit/agents');
    expect(names.sort()).toEqual(readdirSync(promptDirectory).sort());
    for (const name of names) {
      expect(readFileSync(join(promptDirectory, name), 'utf8')).toMatch(/^---\nname:/);
    }
  });
});
