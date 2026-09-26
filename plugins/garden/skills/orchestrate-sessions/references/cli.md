# garden CLI reference

The six session-lifecycle subcommands, read through `--json` rather than the human-readable
text the CLI prints by default.

## Precondition

A garden server must already be running locally. If it isn't, every subcommand below fails the
same way: exit 1, with stderr

```
garden: garden server is not running — start it with `garden`
```

When a subcommand fails, read stderr for this line before assuming anything else went wrong.

## Exit-code branching

Every subcommand resolves to exactly exit 0 (success) or exit 1 (failure) — there is no
differentiated code for not-found vs. server-down vs. any other failure. Branch on that split
alone:

- **Exit 0:** parse stdout as JSON (with `--json`) and use the result.
- **Nonzero exit:** relay the `garden: <message>` line from stderr to the user verbatim. Do not
  pattern-match or parse the stderr text to decide what went wrong — the CLI doesn't expose
  finer-grained failure information than "it failed," so there is nothing more precise to
  extract.

## Create a session

```
garden new <dir> --json
```

`<dir>` is the only argument — there is no flag for repo, branch, or stage preset. Output:

```json
{ "id": "...", "tmuxName": "..." }
```

garden passes no permission-mode or model flag, so the session gets whatever the local `claude`
would use on its own. `GARDEN_CLAUDE_COMMAND` pins the whole command server-wide.

### `--handoff`

```
garden new <dir> --handoff --json
```

One `POST /sessions` that both spawns `<dir>`'s session and hands off the caller's place in its
swarm to it, in one request rather than a spawn plus a separate `handoff`: the caller's
`parent`/`swarmId` moves to the new session, the caller's own children move to it, and the caller
gets `successor` set to the new session's id. Requires `GARDEN_SESSION_ID` in the calling
session's own environment — unset, this fails the same way as `handoff`/`adopt` below (exit 1,
`garden: GARDEN_SESSION_ID is not set`) and spawns nothing. Output is the same
`{ "id": "...", "tmuxName": "..." }` shape as a plain `new`.

## List sessions

```
garden ls --json
garden ls --json --live --status working
garden ls --json --since-days 30 --max-recap-chars 2000
```

Output is a **bare array** of `SessionState` objects — not `{"sessions": [...]}`. Each object:

| field          | meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `id`           | session identifier — what `kill` and `resume` take, not `tmuxName`                    |
| `cwd`          | working directory the session was created in                                          |
| `repoRoot`     | git repo root, or `null` if not in a repo                                             |
| `branch`       | checked-out branch, or `null`                                                         |
| `title`        | display title, or `null`                                                              |
| `recap`        | last recap text, or `null`                                                            |
| `liveness`     | `"live"` or `"dead"`                                                                  |
| `status`       | `"working"` \| `"needs-approval"` \| `"waiting"` \| `"unknown"`, or `null` while dead |
| `statusReason` | free-text elaboration on `status`, or `null`                                          |
| `exitCode`     | process exit code once dead, or `null` while live                                     |
| `tmuxName`     | the underlying tmux session name, or `null`                                           |
| `lastActivity` | epoch ms of the last timestamped transcript line                                      |
| `parent`       | id of the session this one was spawned/adopted under, absent if it has none           |
| `swarmId`      | id of the swarm this session is a top-level member of, absent if it has none          |
| `successor`    | id of the session this one handed off to, absent unless it has                        |

A session is placed in at most one of `parent`/`swarmId` at a time — never both. Walk `parent` up
to find a top-level ancestor's `swarmId` if you need the whole swarm a descendant belongs to
rather than filtering server-side with `--swarm` below.

### Filters

Ask for the subset you want instead of fetching everything and filtering client-side:

| flag                    | effect                                                   |
| ----------------------- | -------------------------------------------------------- |
| `--live`                | live sessions only                                       |
| `--status <status>`     | one of `working`, `waiting`, `needs-approval`, `unknown` |
| `--since-days <n>`      | drop dead sessions idle longer than `n` days             |
| `--max-recap-chars <n>` | keep only the last `n` characters of each `recap`        |
| `--swarm <id>`          | only sessions belonging to that swarm                    |

The since-days/max-recap-chars pair have defaults, so an unfiltered `ls` is already bounded; pass
them explicitly only to widen the window for a specific search. Filtering happens when the list is
read rather than by pruning stored state, so widening always works.

`--swarm <id>` keeps every session under that swarm — top-level members and their
descendants — resolved before the since-days/live/status trimming above is applied. A live
descendant of a dead orchestrator old enough to be dropped by the default 7-day window still
appears under `--swarm`, even though that orchestrator itself does not.

## Kill a session

```
garden kill <id> --json
```

Output: `{ "ok": true }`.

## Resume a session

```
garden resume <id> --json
```

Output: `{ "id": "...", "tmuxName": "..." }` — same shape as create. The session id survives;
the tmux name may not.

## Hand off a session

```
garden handoff --to <id> --json
```

Moves the calling session's place in its swarm to `<id>`: `<id>` takes over the caller's
`parent`/`swarmId` and its children, and the caller gets `successor` set to `<id>`. Requires
`GARDEN_SESSION_ID` in the calling session's own environment — unset, this fails with exit 1 and
`garden: GARDEN_SESSION_ID is not set` on stderr, and moves nothing. A handoff that would create a
cycle, or that targets a session already in a different swarm, is rejected the same way every
other failure is: exit 1, `garden: <message>` on stderr. Output: `{ "ok": true }`.

## Adopt a session

```
garden adopt <id> --json
```

Sets `<id>`'s `parent` to the calling session. Same `GARDEN_SESSION_ID` requirement, unset-caller
failure, and cycle-rejection behavior as `handoff` above. Output: `{ "ok": true }`.
