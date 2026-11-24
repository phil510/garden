# garden Codex plugin

The Codex plugin for garden ships six skills. `orchestrate-sessions` manages sessions through the
Garden CLI, `alert` tells an agent when to raise `garden alert` for the human, `message-session`
addresses another Garden session, `review-queue` reads and acts on review requests with
`garden reviews`, and `watch-pr` starts, handles and stops PR watches. `ship-it` plans and develops
a scoped change, opens a draft PR, runs internal review and any configured bot loop, then marks the
PR ready, watches it through merge and cleans up. In a Codex Garden session, ask Codex to run
`garden-codex:ship-it <ref | free text>`. The planner, developer, reviewer and review-loop workers
run as native Codex subagents, each reading its bundled role prompt in a fresh context. The parent
waits for their reports and advances each run through the authorized stages.

The plugin also ships compaction hooks that require Node 22. The first tool completion, prompt
submission or end of turn that sees context reach 175K tokens asks the agent to write a continuity
note with the goal, decisions, current state, next step, named skills and live workers. A warning at
end of turn blocks `Stop` once so the agent can write the note. After compaction, `SessionStart`
points the agent to the note to read in full and resets the warning marker. The note lives in a
private per-session directory under `os.tmpdir()/garden-codex-compaction-<uid>/`. The session-end hook
removes it, and session start checks up to 100 entries for directories inactive for more than a week.

## The watch-digest forwarder

In the Codex Garden pane that owns the watch, `watch-pr` starts
`garden events --follow --forward-to-session` as a foreground shell task and keeps its process
handle. The command uses the pane's inherited instance and session ID to forward digests through
the same route as `garden send`. Use the owning pane because nested Codex processes inherit that
same ID. Installing the plugin leaves the forwarder to `watch-pr` or `ship-it` to start on demand.

After starting a watch, check that `garden watches --json` shows it as `active` and
`garden ls --json` shows `pipeConnected: true` for the session. The forwarder reconnects and
acknowledges a digest after enqueue succeeds. A disconnect between enqueue and acknowledgment can
repeat a digest, and queue acceptance alone leaves model consumption unverified. Once the session's
last watch ends, stop the owned forwarder explicitly because it can outlive Codex. `ship-it` can
reuse a connected forwarder and releases only its own task when the session no longer needs it.
See the [watch-pr skill](skills/watch-pr/SKILL.md) for the full procedure.

## Upgrading and resuming

For a Git marketplace, run `codex plugin marketplace upgrade garden` and start a new Codex
session to pick up the refreshed plugin. The upgrade was verified through skill discovery in a new
app-server. Live-session reload and automatic update timing remain unverified.

A `ship-it` pipeline saves its state in the pipeline worktree's `.ship-it/` directory. After
upgrading or restarting, ask Codex to run `garden-codex:ship-it resume [<branch | worktree path>]`
in a Garden session. Use the branch or worktree path to identify the run when more than one is
active. A fresh runtime reconstructs the run from disk and accounts for any still-running shell
processes before replacing workers. Compaction can leave workers active in the same runtime, so
the orchestrator checks their status before assigning more work. The watch belongs to its Garden
session and is re-established on resume when needed. See the [ship-it skill](skills/ship-it/SKILL.md).

## Plugin manifest and version

The package uses `.claude-plugin/plugin.json` for Codex's legacy plugin loading. Both that manifest
and the native marketplace entry omit `version`. Codex CLI 0.169.0 caches the unversioned package
as `local`. An explicit Git marketplace upgrade refreshed the installed contents after a Git
revision change while keeping the same `local` cache path. See the pinned sources for
[marketplace upgrade](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/core-plugins/src/manager.rs)
and [cache replacement](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/core-plugins/src/store.rs).

## Plugin descriptions

The native catalog entry supplies the marketplace description. The package manifest carries its
own description for legacy loading. Review both when changing how the plugin is described.

## Installation identity

Install `garden-codex@garden` in Codex. The repository's native catalog at
`.agents/plugins/marketplace.json` lists `garden-codex`.

```sh
codex plugin marketplace add phil510/garden
codex plugin add garden-codex@garden
```

Use a Garden CLI and server build with Codex instance selection, `garden send` and
`garden events --follow --forward-to-session`. Run `garden --codex ls` to check the Codex instance
from outside Garden. A Garden-spawned Codex pane selects its own instance through the inherited
environment. See [Garden's Codex hook trust instructions](../../README.md#codex-sessions).

## Reviewers and parity

`ship-it` uses the specialist reviewer prompts bundled in `agents/`. The reviewer sends the scope,
project instructions and prompt paths to fresh native subagents, then aggregates their findings.
The simplifier reports findings for the developer to act on. See the
[source, license and update procedure](third-party.md).

The optional review loop defaults to `none`. An unavailable configured loop leaves the PR
in draft until the user decides whether to proceed to ready. Merge defaults to asking the user.

The 175K warning assumes you configured auto-compaction at 200K. The plugin reads the latest
native `event_msg/token_count` record's `info.last_token_usage.total_tokens`, which includes cached
and reasoning tokens, and resets the meter at compaction. Native compaction can account for context
the hook cannot see, so the warning is best effort. See the
[plugin maintenance guide](../maintaining.md) before changing these workflows.
