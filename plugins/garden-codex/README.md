# garden Codex plugin

Six skills for a Codex-only garden instance: `orchestrate-sessions`, `message-session`, `alert`,
`review-queue`, `watch-pr` and `review-pr`. Install `garden-codex` from this repo's `garden`
marketplace; the separate Claude package is `garden-claude`. This package includes Codex hooks
and bundled reviewer prompts, with no Claude monitors or automatic named-agent installation.
Ship-it is not implemented here yet.

The CLI/server build must include Codex instance selection, `garden send`, Codex pipe identity,
and `garden events --follow --forward-to-session`. A skill listing alone does not verify those
runtime dependencies. In a garden-spawned pane the inherited instance environment selects the
right server; outside one, explicitly select the Codex instance.

PR notification forwarding is an explicitly owned foreground process started by `watch-pr`.
It reconnects, and a failed enqueue leaves the digest unacknowledged for retry. A successful
queue write followed by a lost ack can repeat a message. It does not prove the model consumed
that message. There is no Codex plugin monitor startup or automatic sidecar cleanup on session
exit; stop the owned task when the run ends. The forwarding process must remain owned by the session that started it.

The manifests omit `version`. Codex CLI 0.169.0 installs this unversioned legacy plugin as
`local`. For a Git marketplace, explicit `codex plugin marketplace upgrade garden` refreshes
the installed contents after a Git revision change even when the version and cache path stay
`local`. This was verified with changed skill discovery in a new app-server; live-session
reloading and automatic update timing were not tested. See the pinned upstream
[marketplace upgrade](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/core-plugins/src/manager.rs)
and [cache replacement](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/core-plugins/src/store.rs).

## Bundled reviews

`review-pr` dispatches fresh native Codex subagents with six bundled Anthropic reviewer prompts.
It resolves paths from the installed skill, passes the diff scope and project instructions, and
aggregates findings. The prompt files are not automatically registered native roles; there is no
TOML installation or user configuration change. See the [upstream source, license and update
procedure](THIRD_PARTY.md). Review requests constrain the simplifier to findings; explicit
simplification requests may authorize edits.

## Compaction notes

The hooks require Node 22 and use built-in modules. The fixed 175K warning assumes the user has
already configured 200K auto-compaction, matching the Claude setup; it does not read or change
user settings. The headroom allows time to write a recovery note. The warning uses the latest native `event_msg/token_count` record's
`info.last_token_usage.total_tokens`; cached and reasoning tokens are already included. A
`compacted` record resets the reported meter. Native compaction may also account for unreported
context and retained reasoning, so this is a best-effort warning, not a guarantee before every
compaction. It does not use lifetime cumulative tokens or the model's maximum context window.

Notes live in a private per-session directory below
`os.tmpdir()/garden-codex-compaction-<uid>/`, independent of ship-it and permanent plugin data.
Normal session end removes that session's files. Session start examines at most 100 entries and
removes directories inactive for more than seven days, bounding cleanup work after crashes.
`PostToolUse` and `UserPromptSubmit` deliver warning context; `Stop` blocks once so the agent can
write the note. `SessionStart` after compaction points the agent to its note to read in full and
resets the warning marker. These hooks preserve live agents; recovery does not start a new run.

See [plugin maintenance and intended differences](../MAINTAINING.md) for parity review. The
optional review-loop boundary defaults to `none`; Garden does not require personal bot-loop or
comment-fetching skills. A future ship-it port must preserve that boundary.
