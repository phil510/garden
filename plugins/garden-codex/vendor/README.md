# Bundled PR review toolkit

Source: [Anthropic claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/fd30cee3ecd5a8ee772733c5d20c0f2bae2da2f0/plugins/pr-review-toolkit),
commit `fd30cee3ecd5a8ee772733c5d20c0f2bae2da2f0`, toolkit version **1.0.1**, retrieved 2026-11-16.
The complete `pr-review-toolkit/` directory is an unchanged copy, including its [license](pr-review-toolkit/LICENSE),
README and versioned upstream manifest. That nested manifest records provenance; the installed
Garden plugin's outer manifest remains versionless. `pr-review-toolkit.sha256` records every file's
SHA-256 digest, relative to that directory.

Garden bundles these prompts so a review does not depend on another plugin being installed.
Claude registers byte-identical copies of the six agents in its own `agents/` directory and wraps
the upstream command with its `review-pr` skill. Codex reads the same prompts from this directory
in fresh native subagents via its own `review-pr` skill. Claude model/color metadata does not
register Codex roles; Codex inherits the current model unless the caller selects one. Review-only
invocation constrains the upstream simplifier to findings. These adaptations live outside the
upstream copy; identical prompts do not promise identical judgments across models.

## Updating

Choose an upstream commit and inspect its license and complete toolkit diff. Replace both plugin
copies from that exact commit, refresh the six registered Claude copies and both checksum files,
and record the commit/version/date here in both packages. Do not run formatters over upstream
files. Run `pnpm exec vitest run tests/plugin/plugin-packaging.test.ts` to check byte preservation,
registration and references, then review both dispatchers for upstream tool or workflow changes.
Follow the [parity review](../../MAINTAINING.md) before shipping either package.
