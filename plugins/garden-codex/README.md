# garden Codex plugin

Five skills for a Codex-only garden instance: `orchestrate-sessions`, `message-session`, `alert`,
`review-queue` and `watch-pr`. Install `garden-codex` from this repo's marketplace instead of the
Claude garden plugin. This package contains no Claude hooks, monitors or Markdown agents.
Ship-it is a separate design and is not implemented here.

The CLI/server build must include Codex instance selection, `garden send`, Codex pipe identity,
and `garden events --follow --forward-to-session`. A skill listing alone does not verify those
runtime dependencies. In a garden-spawned pane the inherited instance environment selects the
right server; outside one, explicitly select the Codex instance.

PR notification forwarding is an explicitly owned foreground process started by `watch-pr`.
It reconnects, and a failed enqueue leaves the digest unacknowledged for retry. A successful
queue write followed by a lost ack can repeat a message. It does not prove the model consumed
that message. There is no Codex plugin monitor startup or automatic sidecar cleanup on session
exit; stop the owned task when the run ends. This lifecycle limitation is deliberate draft
scope and requires a live garden/Codex smoke test before the notification acceptance criterion
can be marked complete.

The manifests omit `version`. Codex CLI 0.169.0 installs this unversioned legacy plugin as
`local`. For a Git marketplace, explicit `codex plugin marketplace upgrade garden` refreshes
the installed contents after a Git revision change even when the version and cache path stay
`local`. This was verified with changed skill discovery in a new app-server; live-session
reloading and automatic update timing were not tested. See the pinned upstream
[marketplace upgrade](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/core-plugins/src/manager.rs)
and [cache replacement](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/core-plugins/src/store.rs).
