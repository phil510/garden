# garden plugin

The Claude Code plugin for garden. Four skills: `orchestrate-sessions` drives the session lifecycle
through garden's CLI, `message-session` resolves a session's messaging address, `watch-pr` tells an
agent when to start, react to and stop a PR watch, and `ship-it` runs a scoped change end-to-end as
a background pipeline (plan, develop, draft PR, internal review, optional review-bot loop, ready
flip, watch through merge), invoked as `/garden:ship-it`. Its four workers ship as agents,
`garden:ship-it-planner`, `garden:ship-it-developer`, `garden:ship-it-reviewer` and
`garden:ship-it-review-loop`, which only the `ship-it` orchestrator spawns. Installed from the
marketplace manifest at the repo root, `.claude-plugin/marketplace.json`.

It also ships two hooks (`hooks/hooks.json`), active as soon as the plugin is enabled — no
configuration needed. `warn.sh` runs after every tool call, on each prompt submission and at the
end of each main-agent turn, and warns once per compaction cycle, on whichever of those events
first sees the session's context reach 175K tokens. It asks the agent to write a
`compaction-status.md` in its scratchpad, recording the goal, decisions, state, next step and any
skills the user called out. When the warning fires at end of turn it arrives as Stop hook
feedback, which resumes the turn once so the agent can write the file. A `SessionStart` hook
fires right after compaction and points the agent at that file to read in full, along with an
instruction to re-check the available skills and invoke any that match, so the agent picks up with
a summary of its own prior state instead of nothing. The file is read rather than injected so a
long one is never truncated and never duplicated when the harness restores it too.

## The watch-digest monitor

`monitors/monitors.json` declares one monitor with `when: "always"`, so every session the plugin is
enabled in starts `monitors/events.sh` at launch. Inside a garden-spawned session (where
`GARDEN_SESSION_ID` is set) it execs `garden events --follow`, which carries PR watch digests into
the session as turns without the agent starting a `Monitor` itself. The pipe is made once, when the
session starts: a session that began before the plugin was installed has none until it restarts
(`garden kill` then `garden resume` keeps the conversation), and `/clear` keeps it. `/clear` does end the session's PR watches, though, so a watch started before
it must be started again.

A monitor that exits is dead until Claude restarts and costs the agent a turn, so the script never
exits on its own. Outside a garden session it does not run `garden` at all: it waits quietly and
ends with Claude. A `claude` started inside a garden session inherits `GARDEN_SESSION_ID`, but
`garden events --follow` checks it against the session's own id and stays silent on a mismatch, so
only the owning session receives digests. When Claude dies, however it dies, the pipe goes with it:
the monitor's stdout is a socket held by Claude, and `garden events` exits when it closes.

A garden session needs a `garden` build that has `events`. The plugin updates on merge but the
linked CLI only on `pnpm build`, so until then a garden session, or a `claude` nested in one, gets
one `script failed` wake at start. Rebuild and restart the session to clear it.

### Known cost: `/exit` asks for confirmation

Claude Code lists a running monitor as background work, so `/exit` (and Ctrl-D) in a session shows
"Background work is running" with "Exit and stop tasks" preselected; one extra Enter exits. Killing
the session from garden does not show it. Nothing in a plugin's monitor config avoids the dialog
(the schema has only `name`, `command`, `description` and `when`, and the dialog lists every
non-ambient monitor), and the options that would, such as starting the monitor on skill invoke, lose
the stream from session start.

## Upgrading and resuming

An installed plugin runs from a copy in `~/.claude/plugins/cache/`, keyed by commit SHA, not from
this checkout. A running session keeps the plugin set it loaded at startup. `claude plugin update`
fetches the new copy and ends with "Restart to apply changes": it takes effect in the next session,
or in a running one after `/reload-plugins` (monitors need a restart).

A `ship-it` pipeline is long-lived, so expect to upgrade mid-flight. Its state lives in the
pipeline worktree's `.ship-it/` directory, not in the plugin or the session. After updating, start a new
session and run `/garden:ship-it resume`: it picks up the new copy of the skill and agents against
the existing state. Nothing live carries over from the old session, so the orchestrator starts with
no workers running.

While a personal `ship-it` skill or agent of the same name exists under `~/.claude`, invoke the
plugin's as `/garden:ship-it` so the right copy runs.

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
https://code.claude.com/docs/en/plugins/loading#versions-and-updates

## The description lives in one place

The marketplace entry omits `description` so `plugin.json` holds the only copy. Entry fields, when
set, override the plugin manifest in plugin listings and details — so a second copy in the entry
drifts out of sync without anything failing.
