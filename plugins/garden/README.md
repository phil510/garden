# garden plugin

The Claude Code plugin for garden. Four skills: `orchestrate-sessions` drives the session lifecycle
through garden's CLI, `message-session` resolves a session's messaging address, `session-handoff`
writes a `.handoffs/*.md` context file for a future session, and `session-pickup` consumes one.
Installed from the marketplace manifest at the repo root, `.claude-plugin/marketplace.json`.

## There is no `version` field, on purpose

Neither `.claude-plugin/plugin.json` nor the marketplace entry declares a `version`. Claude Code
resolves a plugin's cache key from the first version it finds — the plugin manifest, then the
marketplace entry, then the source commit SHA — and that key is what decides whether an update
copies anything into `~/.claude/plugins/cache/`. With no version declared, the key is the commit
SHA, so every merge to `main` is a new key and the change lands.

Declare a version and the key freezes to that string. New commits still arrive in the local
marketplace clone, but the installed copy never changes and `/plugin update` reports the plugin is
already current. No flag forces a refresh: the only way out is `rm -rf ~/.claude/plugins/cache`,
restart, reinstall — which clears every plugin on the machine, not just this one. So a version
field is a standing commitment to bump it on every skill change, and forgetting is silent.

The plugin reference recommends the no-version form for plugins under active development:
https://code.claude.com/docs/en/plugins-reference#version-management

## The description lives in one place

The marketplace entry omits `description` so `plugin.json` holds the only copy. Entry fields, when
set, override the plugin manifest in plugin listings and details — so a second copy in the entry
drifts out of sync without anything failing.
