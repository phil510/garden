# garden plugin

The Claude Code plugin for garden. Two skills: `orchestrate-sessions` drives the session lifecycle
through garden's CLI, and `message-session` resolves a session's messaging address. Installed from
the marketplace manifest at the repo root, `.claude-plugin/marketplace.json`.

It also ships two hooks (`hooks/hooks.json`), active as soon as the plugin is enabled — no
configuration needed. `warn.sh` runs after every tool call, on each prompt submission and at the
end of each main-agent turn, and warns once per compaction cycle, on whichever of those events
first sees the session's context reach 175K tokens. It asks the agent to write a
`compaction-status.md` in its scratchpad, recording the goal, decisions, state, next step and any
skills the user called out. When the warning fires at end of turn it arrives as Stop hook
feedback, which resumes the turn once so the agent can write the file. A `SessionStart` hook
fires right after compaction and injects that file back into context, along with an instruction
to re-check the available skills and invoke any that match, so the agent picks up with a summary
of its own prior state instead of nothing.

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
