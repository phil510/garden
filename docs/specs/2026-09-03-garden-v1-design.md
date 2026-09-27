# garden v1 Design

garden is a local web console for running many Claude Code sessions at once across many repos and
worktrees. tmux owns the Claude Code processes; garden is a viewport and control surface over them.

Companion documents, both canonical in their own domain and not restated here:

| Document                       | Owns                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `docs/architecture.md`         | Code layering, package boundaries, directory tree, lint-enforced import rules |
| `docs/testing.md`              | How to write either test tier                                                 |
| `docs/design/garden-mock.html` | The UI reference: CSS tokens, all user-facing copy, the stage grid            |

## Context and goals

The user runs five to ten repos at a time, branches into `<repo>/.worktrees/<branch>/` routinely,
keeps more than four Claude Code sessions live, and increasingly fans work out to swarms of
sessions. Today that is many terminal tabs with no view of which session needs attention. garden
replaces iTerm2 and VS Code as the place sessions are started, watched, and driven; iTerm2 remains
for ad-hoc shell work.

Claude Code is abbreviated **CC** throughout. This spec supersedes the `cc-console-poc` prototype,
which is thrown away.

Goals:

- Start a CC session in any repo or worktree under configured roots, in one click or one CLI call.
- See every session, live or dead, grouped by repo, with branch, status, and a recap — and know at a
  glance which ones need the user.
- View up to four live sessions at once in fixed layouts, and switch what is on stage quickly.
- Browse and read files in a session's worktree without leaving garden.
- Start and stop with one command. Sessions survive garden restarts.
- Be a pure overlay: nothing under `~/.claude/` is modified, and removing garden leaves CC exactly
  as it was.

### Scope boundaries

Each of these is a plausible follow-on that an implementer might otherwise build unasked.

- **OS notifications and an attention rail.** v1 signals attention in the sidebar only.
- **Transcript panel.** CC's own in-app scrolling covers live sessions; the recap covers dead ones.
- **File editing, diff view, cross-file search.** The file panel is read-only.
- **Drag-and-drop rearranging of panes.** Included only if dockview gives it for free; not built by
  hand in v1.
- **Named workspaces.** v1 has one global stage.
- **Creating worktrees or branches.** CC manages worktrees; garden only discovers them.
- **A plain-shell "new terminal" session type.** Every garden session is a CC session.
- **Light theme.** Dark only, built on CSS variables so light is a later variable swap.
- **An MCP server, and a `garden` skill teaching CC the CLI.** CC reaches garden through the CLI.
  The skill will live in this repo but is separate work.
- **Session handoff/pickup automation.** Briefly reversed by #178 (the `session-handoff` /
  `session-pickup` plugin skills), then removed by #202: compaction recovery hooks (#199) and
  workstream files plus the swarm run folder (#200) carry continuity instead.
- **Multi-user, remote access, auth.** The server binds `127.0.0.1` and this is not configurable.
- **Windows.** tmux is required.

### Principles

- **tmux is the supervisor; garden is disposable.** Killing or restarting the server, or closing the
  browser, never affects a session.
- **Pure overlay on CC.** garden reads CC's transcripts and receives CC's hook calls, but writes
  nothing into `~/.claude/`. Hooks are injected per-process via `--settings`, never installed
  globally. If a task appears to require writing there, stop and escalate — there is no silent
  fallback.
- **The server never parses terminal output.** Status comes from hooks, session facts from
  transcripts, liveness from tmux.
- **The client never touches tmux or the filesystem** except through the server's API.
- **Simpler code over smaller bundle.** This runs on localhost. A maintained library that removes
  stateful UI code beats hand-rolling, unless it is a poor fit.

## Verified premises

Established empirically against **Claude Code 2.1.260** and **dockview 8.2.0 / dockview-core 8.2.0**
on 2026-09-04, on macOS with tmux 3.6a, Node 22.14.0, pnpm 10.23.0. The hook premises were
re-confirmed against **2.1.261** on 2026-09-05. Nothing below needs re-deriving.

**Claude Code hooks**

1. `claude --settings <file>` **merges** rather than replaces: `--help` reads "load _additional_
   settings from". Verified by a project-level `.claude/settings.json` hook and a `--settings` hook
   both firing for one `SessionStart`. The flag accepts a path or inline JSON.
2. Hooks must be **synchronous with `timeout: 1`**, not async. `async: true` is a real key, but async
   hooks are fire-and-forget and are killed when the `claude` process exits, so an async `SessionEnd`
   never lands. `timeout` is per-hook-command, in seconds, and enforced — a `sleep 6` hook with
   `timeout: 2` was killed at 2s. One second bounds the worst-case stall on a ~1ms loopback POST.
3. Every hook payload carries `session_id`, `cwd`, `transcript_path`, `hook_event_name`.
   `permission_mode` is present only on `UserPromptSubmit`, `Stop`, and `PreToolUse` — absent on
   `SessionStart` and `SessionEnd`, so it is typed optional.
4. `Stop` carries `last_assistant_message`, a recap string obtainable with no transcript parsing.
5. `transcript_path` is on every event, so the transcript slug is never derived from a hook.
6. `--bare` must not be passed: its help text says it skips hooks.
7. Available events: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
   `PermissionRequest`, `Stop`, `Notification`. **There is no idle event.**

**Transcripts**

8. The session title is `type: "ai-title"`, field `aiTitle`. There is no `type: "summary"` line
   anywhere in the corpus. `ai-title` lines are interleaved and re-emitted unchanged roughly once
   per user turn — read the **last** occurrence. Two constraints on the parser: the title is
   **often absent** (short sessions with no assistant turn yet have none), and it can appear
   anywhere including line 1, so a title-less record is correct behaviour rather than a parse
   failure. Tolerate `summary` for older transcripts.
9. `type: "last-prompt"`, field `lastPrompt`, is pre-truncated to 200 chars plus an ellipsis and
   re-written after essentially every turn. Good subtitle material, and fresher than `ai-title`.
   Its `leafUuid` is the tip message uuid at that moment.
10. Sidechain (subagent) lines are **not** in the main transcript. Subagent turns live in
    `<slug>/<sessionId>/subagents/agent-<id>.jsonl`, each with a sibling `.meta.json` naming the
    agent type. Across 2,939 main-thread files, zero contained a sidechain line. So: glob
    `<slug>/*.jsonl` **non-recursively**, and the watcher must ignore `subagents/`.
    `isSidechain !== true` stays as cheap defensive filtering. The reason this matters beyond cost:
    a subagent file's `sessionId` is the **parent session's** id, so recursing would attribute
    subagent turns to the parent and corrupt its record.
11. `type` is open-ended. Observed: `user`, `assistant`, `system`, `ai-title`, `last-prompt`,
    `attachment`, `mode`, `permission-mode`, `queue-operation`, `file-history-delta`,
    `file-history-snapshot`, `frame-link`, and more. Conversation lines are `user`/`assistant`;
    everything else is sidecar bookkeeping interleaved in the same file. Unknown types are ignored.
12. The stable envelope on conversation-bearing lines: `cwd`, `gitBranch`, `sessionId`, `timestamp`,
    `uuid`, `parentUuid`, `isSidechain`, `userType`, `entrypoint`, `version`. A duplicate snake_case
    `session_id` sits alongside `sessionId` on some lines and is absent from others — read
    `sessionId`, ignore `session_id`.
13. All lines in a file share one `sessionId`, and the filename always equals it. Verified across 706
    files, zero mismatches.
14. The project-directory slug replaces `/`, `.`, and `_` with `-` — not just `/`. An existing `-`,
    digits, and case all pass through unchanged. Verified across 121 project directories.
    `/Users/…/dbt_snowflake/.worktrees/chore/XAD-4425` →
    `-Users-…-dbt-snowflake--worktrees-chore-XAD-4425` (the double dash is slash-then-dot). The
    mapping is lossy and not invertible (`dbt_snowflake` collides with `dbt-snowflake`), so **never
    reconstruct a path from a directory name** — read `cwd` from the transcript.
15. The slug is fixed at session start and a line's `cwd` can **drift away from it mid-session** —
    a persistent-shell `cd` was observed moving later lines' `cwd` deep into `node_modules` while
    the file stayed put. So a session's cwd is the **first conversation-bearing line's** `cwd`, not
    any line's. This is also what makes the head-and-tail read correct rather than merely cheap.
16. `assistant` `.message.content` is always an array. Block types are `text`, `thinking`, and
    `tool_use` only, and `thinking` frequently outnumbers `text`, so many assistant lines carry no
    text block at all. "Last assistant line" is therefore not "last assistant text": iterate
    backwards until a `text` block appears. `user` `.message.content` is a union of array and
    string, both common (169 string / 512 array in one sample) — handle both.
17. The **first user messages are frequently synthetic** and must not be used as a title fallback:
    slash-command wrappers (`<command-name>`, `<local-command-stdout>`, `<local-command-caveat>`)
    and `isMeta: true` caveat lines. The fallback title is the first `user` line that is not a
    sidechain, not `isMeta`, and does not begin with one of those wrappers.
18. **File mtime is not a reliable activity signal.** A transcript was observed with an mtime six
    days later than its last content line — the file was touched with nothing appended. Recency
    must therefore be measured from the **last line carrying a `timestamp` field**, not from mtime.
    Trailing `mode`, `permission-mode`, `ai-title`, and `last-prompt` lines have no `timestamp` and
    are skipped when finding it.
19. A resumed session **appends to the same file**; no new file is created. Gaps of 10–48 hours
    between consecutive lines are normal, and the `version` field can change mid-file across a CLI
    upgrade. An idle gap is marked by a `type: "system"`, `subtype: "away_summary"` line whose
    `content` is a prose recap — a better recap than the last assistant text where one exists.
20. There is **no end-of-session marker line** of any kind. Nothing in a transcript says whether its
    session is still running; that is tmux's job alone.
21. Several observed line types (`ai-title`, `away_summary`, `pr-link`, `cost-state`) may be
    specific to this installation rather than universal. Every one of them is optional in the
    parser, and their absence is never an error.
22. Transcripts are enormous: 1.6 GB across 121 project directories, and a 10 MB file can be 329
    lines. Line count is not turn count. **A read-every-file boot is not viable** — see "Bounded
    transcript reads" under Architecture.

**tmux and terminal**

23. CC keeps the terminal in the alternate screen and tmux history stays at zero, so terminal
    scrollback is not available. CC scrolls its own conversation with PgUp/PgDn and, when tmux has
    `mouse on` and the client forwards mouse events, with the wheel.
24. `remain-on-exit` must be on when the tmux server starts. A `-f` config file on a dedicated `-L`
    socket guarantees this with no re-issue.
25. Two tmux clients attached to one window share one size; grouped sessions do not change that.
    garden allows one attach per session from its own UI. An iTerm2 attach via the copied command is
    a foreign client garden does not detect; with `window-size latest` the most recently attached or
    resized client sets the size.
26. `claude --session-id <uuid>` and `claude --resume <id>` both exist, so the spawner knows a
    session's id before its transcript exists.

**dockview** (full evidence in `docs/plans/2026-09-04-dockview-spike-results.md`)

27. `fromJSON(data, { reuseExistingPanels: true })` preserves xterm instances and their WebSockets
    across a preset switch: zero socket closes across every surviving pane, versus all four closing
    on a control run without the option.
28. Proportional layout holds exactly on dockview's own resize path with no reapply call — 60.0/40.0
    at five widths, 50.06/50.05% at three heights. `DockviewComponent`'s constructor hardcodes
    `proportionalLayout: true` and never reads the option, which is why it is not a member of
    `DockviewOptions`.
29. Maximize and exit drop nothing, and a hidden pane keeps non-zero geometry throughout. No pane
    ever measured zero in either dimension at any stage size down to 40px; below the 100px per-pane
    floor the layout overflows rather than collapsing, so xterm's fit addon and tmux sizing are not
    at risk. The floor is overridable per group via `options.constraints`.
30. A three-pane layout round-trips through `toJSON()` at ~987 bytes — small enough to persist in
    `state.json`. It stores absolute pixel sizes and the authoring viewport; proportions are
    re-derived from those sizes on load.
31. `hideHeader: true` is first-class and serializable, and round-trips on `toJSON`. Paired with
    `locked: true` it removes tab bars and drop targets with no CSS hacks.
32. `onDidDispose` does not exist. Component-level `api.onDidRemovePanel` is the teardown trigger:
    reused panels fire nothing, only genuinely dropped panels fire. `onDidMovePanel` fires
    **spuriously** for every reused panel during a `fromJSON`, pointing at a detached temporary
    group — layout state must never be derived from it.

**Environment and packaging**

33. node-pty `latest` (1.1.0) is unusable on macOS: it ships `prebuilds/darwin-*/spawn-helper` mode
    `0644`, so every `pty.spawn` fails with `posix_spawnp failed`. `1.2.0-beta.15` ships the
    executable bit baked into the tarball, so no install script needs to run under pnpm 10, and it
    is the only line with Linux prebuilds — which is what makes a CI integration job possible.
34. Chrome is present at `/Applications/Google Chrome.app`. Web Notifications work on
    `http://127.0.0.1` in Chrome with no manifest or PWA install. Not needed in v1; recorded for the
    follow-on.

### To verify

- **Nothing blocking.** Every item the earlier draft listed as unverified has been resolved above.

## Architecture

Four processes:

1. **tmux server** on a dedicated socket (`tmux -L garden`), started with `~/.garden/tmux.conf`.
   Owns every CC process. Config sets `remain-on-exit on`, `mouse on`, `status off`,
   `default-terminal tmux-256color`, `terminal-features ",*:RGB"`, `aggressive-resize on`,
   `window-size latest`. The user can reach any session from iTerm2 with
   `tmux -L garden attach -t <name>`.
2. **garden server**, a long-lived Node process started by the CLI, with pid and log in `~/.garden/`.
   Shells out to tmux and git, watches `~/.claude/projects/`, receives hook POSTs, holds the overlay
   store, and serves the built client, an HTTP API, and WebSockets. Binds `127.0.0.1`.
3. **CC processes**, one per tmux session, launched as
   `claude --session-id <uuid> --settings ~/.garden/claude-settings.json`. Their hooks POST to the
   server.
4. **Chrome app window** (`--app=http://127.0.0.1:<port>`), a disposable viewport.

The server's internal shape — the pure `reduce`/`diff` core, the adapter and port boundaries, the
package split — is `docs/architecture.md`'s subject and is not repeated here. What follows is the
behaviour those layers implement.

### Data flow

- **Registry.** On boot and on file change, the server turns each in-scope `*.jsonl` into a session
  record: id (from the **first** conversation-bearing line), repo root (git toplevel of the current
  cwd), cwd and branch (from the **last** conversation-bearing line), title, recap, and last
  activity. Last activity is the timestamp of the last line
  carrying one — not file mtime, which can advance with nothing appended. Only sessions whose cwd is
  under a configured root are kept. Sessions started outside
  garden — plain `claude` in iTerm2, or before garden existed — are included, which is how historical
  sessions become resumable. Records merge with `tmux list-sessions` output and hook-derived status
  into session state, sent to clients as a snapshot on connect and deltas thereafter.
- **Create.** `POST /sessions {cwd}`. The server mints a uuid, derives a unique tmux name from the
  folder name, runs `tmux new-session -d` on the garden socket with the config file, that cwd, the
  server port in the environment, and `claude --session-id <uuid> --settings …` as the command, then
  records uuid → tmux name in the store. The registry picks up the transcript when CC writes it.
- **Attach.** The client opens a pane WebSocket for a session id; the server spawns
  `tmux attach -t <name>` in a node-pty and pipes bytes both ways. Client resize messages drive the
  pty size. Closing the socket ends the attach and nothing else. A second attach for an
  already-attached session is refused, and the client moves the existing pane instead.
- **Resume.** One command with two mechanisms, chosen by whether tmux still holds the session. If it
  does — the pane is dead but the tmux session survives, which is what `remain-on-exit on` is for —
  `respawn-pane -k` runs `claude --resume <id>` in place, reusing the tmux name, any attached pane,
  and the store mapping, so a pane on stage comes back to life where it sits. If it does not —
  historical session, killed session, or the tmux server restarted — resume is a create with
  `claude --resume <id>` at the recorded cwd and a fresh tmux name. Both paths are offered as the
  same Resume action on the same `dead` session; the split is an implementation detail and never
  surfaces in the UI. **The session id never changes**, so the card keeps its identity either way.
- **Kill.** Kill the tmux session and drop the id → name mapping. tmux no longer reports the
  session, so it is `dead` on the next snapshot with no exit code — no special-casing needed. The
  transcript remains, so the card stays and stays resumable.
- **Status.** CC hooks POST their stdin JSON; the server maps the event to a status for that session
  id and pushes a delta.

### Bounded transcript reads

The transcript-size premise makes this a design constraint, not an optimisation. A session record needs only
`sessionId`, `cwd`, `gitBranch`, the last `aiTitle`, the last `lastPrompt`, a recap, and the last
line timestamp. Two
cheap filters apply in order, before any file is opened:

1. **Directory-name prefix filter.** A cwd under a configured root produces a slug starting with that
   root's slug. Encode each root and keep only matching directories — this discards most of the 118
   directories without a single read.
2. **Head-and-tail read, never the whole file.** The first conversation-bearing line gives
   `sessionId`; `cwd` and `gitBranch` come from the last conversation-bearing line, alongside the
   title, last prompt, and recap. Read a bounded head and a bounded tail and parse only the
   complete lines within each. A single line can exceed the window — a record missing a title is
   then correct behaviour, not an error.

Deciding _which_ bytes to read is adapter work; turning text into a record stays pure.

### Session state

Each fact has exactly one source:

| Fact                                                 | Source                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| exists, id, cwd, branch, title, recap, last activity | transcript                                                                     |
| repo root                                            | git toplevel of the session's cwd                                              |
| liveness, exit code, tmux name                       | tmux (`list-sessions`, `pane_dead`, `pane_dead_status`) plus the id → name map |
| status, while live                                   | hooks                                                                          |
| shown                                                | garden's own stage state                                                       |

Whether a pane socket is currently open for a session is **not** in that table and is not part of
session state. It is server-internal bookkeeping owned by the attach path, used for one thing:
refusing a second concurrent attach. The client never needs it — a session already on stage is
already in a slot, so `shown` is what tells the client to move the existing pane rather than open a
second one.

The recap comes from the transcript and only the transcript, even though the `Stop` hook carries
`last_assistant_message` and would be cheaper. One source keeps the recap identical for a session
garden started, a session it did not, and a session it is seeing for the first time after a
restart — a hook-fed recap would be present for some sessions and absent for others with no rule a
reader could predict.

A session is described by **three independent axes**. Keeping them independent is the point: any
combination of the three is reachable and meaningful, and none of them is derived from another.

**1. Liveness — `live` or `dead`.** Two values, one question: does tmux report a live pane for this
session?

- **`live`** — tmux knows this session and its pane is not dead.
- **`dead`** — everything else. The pane exited, the tmux session is gone, the tmux server was
  restarted, or garden never started this session at all. All of these are the same thing to the
  user: Claude Code is not running, and Resume is offered.

Garden asks tmux and believes the answer. There is no activity heuristic, no time window, and no
inference from transcript freshness — which is what makes this derivation pure and independent of
the clock. A session garden did not start looks exactly like any other dead session.

The accepted cost: a session running in a terminal garden does not own also reads as `dead` and
offers Resume, and taking it would leave two `claude --resume` processes appending to one
transcript. That is rare and is the user's discipline to keep, not something to engineer around. The
alternative — inferring "probably running elsewhere" from recent transcript activity — was tried and
rejected; see Costly-to-reverse decisions.

Two **fields**, not states, carry what a dead session still knows:

- `exitCode: number | null` — the pane's exit status, available only while tmux still holds the dead
  pane, which is what `remain-on-exit on` buys. Null once the tmux session is gone.
- `tmuxName: string | null` — present while tmux still holds the session. Its presence decides two
  things and nothing else: Resume respawns the pane in place rather than creating a new session, and
  the "copy attach command" action is offered.

**2. Status — only while live.** A dead session has **no status at all**, not a status of `unknown`.
The field is null and the UI renders no pill.

**3. Shown — is this session in a stage slot?** Purely garden's own state, independent of both axes
above. A dead session can be shown (its pane renders the dead placeholder with its exit code and a
Resume button), and a live session can be unshown. Nothing about liveness decides whether a session
may go on stage.

Status values, applying to live sessions only:

| Hook event                                                      | Status                                               |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | `working`                                            |
| `PermissionRequest`                                             | `needs-approval`                                     |
| `Stop`                                                          | `waiting`                                            |
| `Notification`                                                  | `waiting`, with the notification message as a reason |
| `SessionEnd`, or tmux reports the pane dead                     | liveness becomes `dead`; status is cleared           |

A live session with no hook event since the server started is `unknown`. After a server restart that
is the correct state, not a defect: it resolves on the next hook event. `unknown` is a live-session
status meaning "running, but garden has not heard from it yet" — it is never used for a dead
session, which simply has no status.

### Data

`~/.garden/` holds `config.json` (roots, port), `state.json`, `tmux.conf`, `claude-settings.json`,
`server.pid`, and `server.log`. Uninstall deletes this directory; nothing else on disk belongs to
garden.

`state.json` is written atomically and holds **overlay facts only** — things garden decided and
cannot recompute. It does not hold a session-state snapshot, because every session fact is derived
from tmux and the transcripts on every boot and a persisted copy of them can only be wrong.

```json
{
  "version": 1,
  "tmuxNames": { "<session-uuid>": "<tmux-session-name>" },
  "hideDead": false,
  "groups": {
    "<repo-root-path>": { "pinned": true, "order": 0, "collapsed": false }
  },
  "stage": {
    "preset": "single | two-across | two-stacked | three | grid-2x2",
    "slots": ["<session-uuid>", null, null, null],
    "focusedSlot": 0,
    "layout": {}
  }
}
```

`stage.layout` is dockview's own `toJSON()` output, stored opaquely and handed back to `fromJSON`.
garden never reads inside it; `slots` is garden's own record of what belongs where.

Boot is a replay, not a restore: load config and store, dispatch the id → name map, dispatch a full
tmux snapshot, dispatch one transcript event per in-scope file, then start the watcher, the tmux
poll. Steps three and four emit the same events the adapters emit in normal
operation, so there is no separate reconciliation path to get wrong.

### APIs and contracts

All endpoints are loopback-only. Request and response shapes are typed in `packages/shared`, which is
the single definition both sides import; they are not restated here.

| Endpoint                      | Purpose                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `GET /sessions`               | All session states                                                  |
| `POST /sessions {cwd}`        | Create; returns id and tmux name                                    |
| `POST /sessions/:id/resume`   | Resume in place or as a new tmux session                            |
| `POST /sessions/:id/kill`     | Kill the tmux session                                               |
| `GET /repos`                  | Repos and `.worktrees/*` under the configured roots, for the picker |
| `GET /fs/tree?session=&path=` | Lazy directory listing, scoped to the session's cwd                 |
| `GET /fs/file?session=&path=` | File contents, scoped to the session's cwd                          |
| `POST /hooks`                 | CC hook payloads                                                    |
| `PUT /ui-state`               | Overlay-store fields owned by the client                            |

Both `/fs` endpoints reject any path resolving outside the session's cwd. That check is a pure
function and is security-critical.

Two WebSockets: `WS /events` sends a snapshot then deltas; `WS /attach/:id` carries the pane byte
stream and resize messages.

Server state is read-only in the browser. Components issue commands and the change arrives back as a
delta — there are no optimistic writes and no client-side prediction, so client and server cannot
disagree.

### CLI

`garden` is a thin HTTP client to the local server, so the UI and CC drive one code path.

- `garden` — start the server if needed, open the Chrome app window. If Chrome is absent, print the
  URL and exit 0.
- `garden stop` — stop the server. tmux and sessions untouched.
- `garden new <dir>` — create a session; prints id and tmux name. `--json`.
- `garden ls` — sessions with status. `--json`.
- `garden kill <id>`, `garden resume <id>`.
- `garden uninstall` — stop the server, kill the garden tmux server after confirmation, delete
  `~/.garden/`.

Exit 0 on success, non-zero with a message on stderr otherwise. No interactive prompts except the
uninstall confirmation, which `--yes` skips.

### Client surfaces

**Sidebar.** Groups are repos, keyed by git root, so worktrees fold into their repo. A group header
carries repo name, live count, an attention badge (any `needs-approval` or `waiting` inside), and a
collapse chevron; it collapses to one row. Order is pinned groups first in the user's drag order,
then unpinned by most recent activity; dragging a group pins it. A repo appears only once it has a
session in the registry.

Session rows show title (falling back to the first user prompt), branch or worktree name, a status
pill, and an on-stage marker, sorted by most recent activity. A `dead` row, having no status to
show, sits at reduced contrast so live work stands out down a long sidebar — de-emphasis only: its
title, branch, and actions stay legible and clickable, and hover or being on stage brings it back to
full contrast. Hover reveals recap, session id, cwd, and last activity. Visible by default: every
`live` session, plus `dead` sessions whose last activity is within 14 days, with a per-repo "show
older" expander and a global hide-dead toggle.

Row actions. Clicking any row puts that session on stage, live or dead — "shown" is independent of
liveness. A `live` row offers Kill, with confirmation. A `dead` row offers Resume. Copying the
`tmux -L garden attach -t <name>` command is offered whenever `tmuxName` is set, which is every live
session and a dead one whose tmux session tmux still holds. **New session** opens a picker
listing repos under the configured roots plus each repo's `.worktrees/*`, filterable by typing.

**Stage.** Five presets: single; two side by side; two stacked; three (large left, two stacked
right); 2x2. Switching presets keeps panes in slot order and returns any that no longer fit to the
sidebar. Clicking a sidebar session fills the first empty slot, else replaces the focused pane; a
session already on stage is moved, never duplicated. The focused pane has a visible border.

A pane header carries title, branch, status pill, maximise toggle, and ×. Double-click maximises,
hiding siblings rather than unmounting them so sockets and rendered state survive; × returns the
session to the sidebar without killing it. Terminals are xterm.js with a theme ported from the
user's iTerm2 palette, mouse reporting forwarded so CC's wheel scrolling works, fit-on-resize
driving the tmux size, and `path:line` link detection. Preset, slot assignments, and focus persist in
the overlay store.

xterm instances and their pane sockets live in a module-level registry outside React's tree, keyed by
session id, because remounting one drops the socket and clears the screen. Panel ids in the dockview
layout are therefore session ids — that identity is what `reuseExistingPanels` matches on. Every
panel is one pane in its own group with `renderer: 'always'`; panels failing that test share a
staging group where only one survives.

**File tree and viewer.** A toggleable right panel bound to the focused pane's session, rooted at
that session's cwd; switching focus switches the tree. Directories load lazily through the API,
gitignored files are hidden behind a toggle, git status decorations come from one
`git status --porcelain` per refresh, and refresh is driven by a debounced filesystem watch. The
viewer is read-only with syntax highlighting, line numbers, and a size cap with "open anyway" — one
file at a time, no tabs. A `path:line` click in terminal output opens that file at that line,
resolved against the session's cwd; a missing path is a no-op.

**Appearance.** Dark theme only, on CSS variables. Status colours are the one place colour carries
meaning, and are consistent between sidebar pills and pane headers. `docs/design/garden-mock.html` is
the reference for tokens and copy.

### Error handling

- tmux missing or too old: the CLI fails at startup with a message and attempts nothing else.
- A hook for an unknown session id is stored under that id anyway — the transcript may not exist yet.
- An unparseable transcript line is skipped and logged once per file; the rest of the file is kept.
  Deciding a line is unusable is pure; reporting it is I/O.
- A shown session that is dead renders the dead placeholder rather than a terminal: its exit code if
  tmux still holds the pane, and a Resume button. Whether tmux holds the pane changes only the exit
  code line, not the placeholder.
- Server restart with live sessions: they show `unknown` until their next hook event, re-associated
  by the store's id → name map. Pane attaches die with the server; the client reconnects the event
  socket with backoff and reattaches every on-stage pane automatically.
- `garden` when the port is in use: if `server.pid` names a running garden server, just open the
  window; otherwise fail with a message naming the port and the config file.
- Chrome app window closed: nothing happens server-side.
- The client renders degraded state — `unknown` status, a stale badge, an empty tree — rather than
  error dialogs.

## Costly-to-reverse decisions

**tmux is the supervisor, not garden.** garden shells out to a tmux server on its own `-L` socket and
never owns a CC process directly. The alternative was garden spawning CC in ptys it owns, which
would make every session die with the server and make iTerm2 fallback impossible. Reversing this
means rewriting the entire process model, the resume path, and the liveness derivation.

**Pure overlay: hooks injected per-process via `--settings`.** The alternative is installing hooks
into `~/.claude/settings.json` globally, which breaks the promise that removing garden leaves CC
untouched and would leak garden's hooks into every session everywhere. The verified `--settings` merge semantics make the per-process route work. Reversal is cheap in code but is a user-facing promise, so
it is a decision the user makes, never a silent fallback.

**Hooks synchronous with `timeout: 1`.** Async hooks lose `SessionEnd` entirely, which
would leave exited sessions stuck as `live` until a tmux poll caught them. The cost is a bounded 1s
stall per hook if garden is down. Reversing means giving up hook-driven session-end detection.

**Session state is derived on every boot; only overlay facts persist.** The alternative is
persisting a `SessionState` snapshot for a faster start. Rejected because tmux and the transcripts
are the sources of truth and a stored copy can only be wrong. Reversal means introducing a
reconciliation path that the replay design specifically exists to avoid.

**Liveness is two values, asked of tmux alone.** `live` or `dead`, decided solely by whether tmux
reports a non-dead pane. The alternative, built and then removed, was a four-value model with an
`external` state inferred from transcript activity in the last 10 minutes, meant to suppress Resume
on a session running in a terminal garden does not own. It was rejected for three reasons. It got
the important case backwards: tmux losing a session it had a mapping for fell through to the
activity heuristic, so after a reboot the sessions most recently in use showed `external` and were
given no actions, while idle ones went `dead` and resumed fine. It made the core derivation
time-dependent, which forced a clock port, an `at` timestamp on every event, and a periodic `tick`
event whose only job was aging sessions out of the window. And it bought only a guard against a rare
mistake the user prefers to own. Reversing this means reintroducing the clock into the fold — the
cost is not the enum, it is that every event and the whole reduce path becomes time-dependent again.

**dockview 8.2.0 for the stage.** The alternative was ~60 lines of hand-rolled CSS grid, and dockview
had to win outright to displace it. It does: the dockview premises above show preset switches preserve sockets and
resize preserves proportions, both on dockview's own documented-in-types paths, with no workaround.
react-mosaic was disqualified — `MosaicTabs` renders only the active tab, and its v7 n-ary rewrite
reintroduced path-keyed Fragment nesting, so a tile changing depth remounts. Reversal costs the
stage's layout code and the persisted `stage.layout` blob, but nothing outside the stage: the
terminal registry owns the xterm instances regardless of who owns the layout. Residual risk:
`reuseExistingPanels` is undocumented on the docs site, though it is in the shipped public types and
read at runtime. Mitigated by the behavioural guard under Testing.

**node-pty pinned to exactly `1.2.0-beta.15`, no caret.** The `1.1.0` release is broken
on macOS and has no Linux prebuilds at all. The beta line is taking real behavioural changes (winpty
removal, FD-close semantics), so the exact pin matters more than usual. Track microsoft/node-pty#919
for a 1.1.x patch. The bundle must mark node-pty external and ship the platform's `prebuilds/`
alongside `dist/` — a native addon cannot be bundled, and the build succeeds and then fails at
runtime looking for `pty.node`.

**Server binds `127.0.0.1`, not configurable.** There is no auth, and no path scoping strong enough
to make the `/fs` endpoints safe on a network. Reversal means designing authentication.

**One JSON file for the store, not a database.** The data is a handful of maps and one layout blob,
written on user actions. Reversal is a migration of a single small file.

**Stack:** TypeScript 6, Node 22 (`>=22.0.0 <23`), pnpm 10 workspace. Server: Fastify 5, `ws`,
node-pty, chokidar, `execFile` for tmux and git. Client: React 19, Vite 8, zustand, xterm.js 6,
dnd-kit, dockview-react 8.2.0, shiki 4.4.3. Tests: vitest 4. Every dependency version lives in the
`catalog:` block of `pnpm-workspace.yaml` and every `package.json` carries the literal string
`catalog:` — a version range in a `package.json` is a defect. No dependency version published within
7 days of adoption.

Two smaller stack choices, recorded so they are not reopened. **shiki** for the viewer: the only
actively-maintained candidate giving the VS Code dark theme the console already imitates, and it
needs no Vite config because its wasm ships inlined. Line numbers are a CSS counter; shiki has no
line-number transformer. react-syntax-highlighter was rejected for having no commits in six months
and bundling a 2020-era highlight.js major. **`node:util` `parseArgs`** for the CLI: commander 15
requires Node ≥22.12.0, above this repo's floor, and seven subcommands with `--json`/`--yes` do not
justify a dependency.

Rejected outright, so they are not reintroduced: vanilla TS with no framework (hand-rolling stateful
UI the libraries provide); tmux control mode in place of node-pty (writing a multiplexer client for
an under-documented protocol); parsing terminal output for anything, ever.

## Testing

Two tiers, both defined in `docs/testing.md`. `execFile` is never mocked anywhere — tmux's only
legitimate fake is a port at the application tier. Any test that waits polls with a deadline and
fails with its last observation; no test sleeps.

**Unit, on pure logic** — the bulk of the suite, expressed as events in and state out:

- Transcript text to a session record: the last-`aiTitle`-wins rule and a title-less record for a
  transcript with no `ai-title` line; the backwards walk for the last assistant `text` block past
  `thinking` blocks; the array-or-string `user` content union; a synthetic first user message
  (`<command-name>`, `isMeta`) skipped in favour of the first real prompt; cwd taken from the first
  conversation line rather than a later one that drifted; last activity taken from the last
  timestamped line rather than trailing untimestamped sidecar lines; unknown line types ignored;
  and unparseable lines skipped with a count returned.
- Hook event to status, including `Notification` carrying its message through as a reason.
- Liveness derivation, which is now small enough to pin exhaustively: `live` only when tmux reports a
  non-dead pane; `dead` for a dead pane, a vanished tmux session, a session garden never started, and
  a session killed by garden. That the derivation takes no clock input at all is itself worth a test —
  the same inputs must give the same answer at any time.
- `exitCode` and `tmuxName` are populated only while tmux still holds the session, and a dead session
  with no tmux name still offers Resume.
- Status is cleared when a session goes dead, and a status-bearing hook arriving after the pane died
  does not resurrect it.
- The fold: `reduce` is total over every event variant, boot replay is order-independent and
  idempotent, and `diff` → `applyDelta` round-trips over hand-written event sequences.
- Group ordering with pins and collapse.
- Stage slot arithmetic across every preset change, including panes evicted when the new preset has
  fewer slots.
- **Path scoping for the `/fs` endpoints.** Security-critical: `..` traversal, absolute paths,
  symlinks pointing outside the cwd, and a path that is a prefix-string match but not a real
  descendant.

**Integration, against the real thing** — tmux on an isolated `-L` socket, git in a temp repo:

- Create, attach and stream real bytes, kill, dead-pane detection with the correct exit code, and
  `remain-on-exit` taking effect on a fresh tmux server.
- A real CC hook command reaching a real server endpoint.
- Resume in place via `respawn-pane` reusing the tmux name, and resume as a fresh tmux session, with
  the session id unchanged across both.

**One behavioural guard on dockview**, in a headless DOM environment: a preset switch with
`reuseExistingPanels` that must preserve every surviving pane's socket, paired with a control run
without the option that must not. This pair is the mitigation for that option being undocumented —
it is what turns a silent upstream regression into a failing test.

No browser end-to-end tests in v1.

## Follow-ons, in rough order of value

1. OS notifications when the window is unfocused, then an attention rail across the top.
2. Drag-and-drop pane rearranging if dockview does not give it for free; named workspaces.
3. Transcript panel from the JSONL.
4. Diff panel scoped to a session's worktree.
5. A `garden` skill in this repo; then an MCP server if the CLI proves awkward for CC.
6. New-terminal session type; create-worktree in the picker.
7. Light theme.
8. Native shell (Tauri) if web notifications or Dock integration prove too weak.
