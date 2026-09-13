# garden CLI reference

The four session-lifecycle subcommands, read through `--json` rather than the human-readable
text the CLI prints by default. `garden stop` and `garden uninstall` also exist; they target the
server process rather than a session and are out of scope here.

## Precondition

A garden server must already be running locally. If it isn't, every subcommand below fails the
same way: exit 1, with stderr

```
garden: garden server is not running — start it with `garden`
```

Check for this once rather than re-deriving it per command — if a subcommand fails, read stderr
first to see whether this is the cause before assuming anything else went wrong.

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

The session inherits the permission mode and, by default, the model the local `claude` would
use on its own — garden passes no flag for either, though `GARDEN_CLAUDE_COMMAND` can pin the
whole command server-wide. So a dispatched peer is not necessarily in the mode, or on the
model, that this session is.

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

### Filters

Without filters, `ls` returns every session the server has ever loaded — hundreds, nearly all
dead. Ask for the subset you want instead of fetching everything and filtering client-side:

| flag                    | effect                                                   |
| ----------------------- | -------------------------------------------------------- |
| `--live`                | live sessions only                                       |
| `--status <status>`     | one of `working`, `waiting`, `needs-approval`, `unknown` |
| `--since-days <n>`      | drop dead sessions idle longer than `n` days             |
| `--max-recap-chars <n>` | keep only the last `n` characters of each `recap`        |

The last two have defaults, so an unfiltered `ls` is already bounded; pass them explicitly only
to widen the window for a specific search. Filtering happens when the list is read, not by
pruning stored state, so widening always works — nothing has been thrown away.

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
