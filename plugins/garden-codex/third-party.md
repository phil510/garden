# PR review toolkit attribution

The six specialist reviewer prompts in `agents/` and the `review-pr` workflow derive from
[Anthropic’s PR review toolkit](https://github.com/anthropics/claude-plugins-official/tree/fd30cee3ecd5a8ee772733c5d20c0f2bae2da2f0/plugins/pr-review-toolkit),
revision `fd30cee3ecd5a8ee772733c5d20c0f2bae2da2f0` (version 1.0.1), retrieved 2026-11-16.
They are distributed under the [Apache License 2.0](licenses/pr-review-toolkit-LICENSE).

These are editable Garden forks: reviewer formatting and the workflow are adapted for this
package, including findings-only review and native agent dispatch. Each plugin owns one working
copy of each reviewer. Changes require [semantic parity review](../maintaining.md), not byte
identity with upstream or the other harness.

For upstream updates, inspect the diff and license changes from the recorded revision, then
manually apply relevant changes to the working reviewers and dispatcher. Preserve local
adaptations and notices; do not replace the forks wholesale. Record the new revision here and
run `pnpm exec vitest run tests/plugin` before reviewing parity across both packages.
