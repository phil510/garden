# garden — architecture

How this codebase is organised and why. Read this before adding code. It describes structure,
boundaries and the invariants behind them, not features: what garden does is in the code and
`packages/shared`, and planned work is in GitHub issues.

## 1. The model everything follows from

garden has five sources of truth about the outside world:

- **tmux** — which sessions exist, which panes are alive, exit codes.
- **transcripts** — the selected harness's conversation files: Claude project JSONL files or bound Codex rollouts.
- **hooks** — the selected harness POSTs native events, translated to garden signals at the boundary.
- **native metadata** — a passive Codex backend connection reports the bound thread's status and title. The Codex session index supplies stored titles.
- **clients** — the browser and the CLI issue commands.

All five fold into one thing: a map of session id to session state. That map streams to
browsers as a snapshot on connect, then as deltas. Some things travel outside the delta stream.
Two are global messages on `/events` beside the session deltas: `ui-state`, the persisted UI
slice, and `reviews`, the queue of open PRs awaiting the user's review (`app/reviews.ts`, an
in-memory store fed by `app/reviewPoller.ts`). A third is a client's inbound `watch` message and
the `fs-changed` it earns: a per-connection filesystem watch, answered to that connection only.
The last is the per-session pipe stream (`WS /sessions/:id/events`), which pushes PR-watch digest
lines to a `garden events --follow` process and takes acks back (§4.6).

Every layer in this codebase exists to serve that sentence. Adapters turn the outside world
into events. One pure function folds events into state. One diff turns state changes into
deltas. If you are unsure where code belongs, ask which of those three jobs it is doing.

The hard part of garden is not any individual feature — it is that those sources are
unsynchronised. A hook arrives before the transcript file exists. A pane dies while a client is
attached. The server restarts and has to re-associate session ids to tmux names. A hook reporting
`working` lands after tmux has already seen the pane die. Keeping that folding logic in one pure,
testable place is the central architectural decision here, and most of the rules below follow from
protecting it.

### 1.1 Invariants

Three decisions shape the whole system and are expensive to reverse. Check the reason before
changing one.

- **tmux is the supervisor; garden is disposable.** Every harness process runs in a tmux
  session on garden's own socket (`tmux -L garden-claude`, started with the conf `appdir.ts` writes).
  Killing the server or closing the browser never touches a session. Had garden owned the ptys,
  every session would die with the server, and you could not reach a session from another
  terminal with `tmux -L garden-claude attach -t <name>`. Reversing this rewrites the process model,
  resume and the liveness derivation.
- **Per-process overlay.** Garden writes its configuration and identity state under `appDir`,
  and injects hooks into each process rather than editing the user's harness configuration.
  Claude receives `--settings <appDir>/claude-settings.json`; its `~/.claude/` tree stays read-only.
  Codex receives hook configuration on a private per-session backend. Hook trust is approved
  through Codex's native UI and persisted by Codex; Garden never writes trust records.
  The separately installed plugins remain opt-in.
- **Loopback only, no auth.** The server listens on `127.0.0.1`; `HOST` in `config.ts` is a
  constant, not a setting. Nothing authenticates a request, and the `/fs` endpoints serve file
  contents scoped only by session cwd, which is not strong enough to expose to a network.
  Supporting remote access means designing authentication first.

### 1.2 What a session's state is made of

Each fact has one primary source, with three exceptions below the table. `domain/reduce.ts`
merges them; nothing else computes a session fact.

| Fact                          | Source                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| id, cwd, recap, last activity | transcript; launch registration supplies id/cwd before it exists, including pending Codex aliases replayed at boot |
| title                         | Codex native thread name when present, otherwise the transcript's title or last prompt                             |
| tmux name                     | the id-to-name map in `state.json`, written by `dispatch` when a session is (un)registered                         |
| liveness, exit code           | tmux pane facts (`pane_dead`, `pane_dead_status`), overridden to dead by `ended`                                   |
| `ended`                       | hooks: `SessionEnd` sets it, `SessionStart` clears it; `session-registered` also clears it                         |
| status, reason                | harness-neutral signals or launch registration (harness adapters hold the native event-to-status mappings)         |
| branch                        | a live git lookup by cwd (`app/branches.ts`), re-asked each tick for live sessions                                 |
| repo root                     | `git rev-parse --git-common-dir` on the cwd (`app/repoRoots.ts`), so worktrees fold into their main repo           |
| Session name                  | Claude registry snapshot or Garden handle persisted in the Codex alias store                                       |
| watches                       | the watch records in `state.json`, projected onto the session by a `watches-changed` event                         |
| alert                         | `garden alert` or the web Dismiss, persisted in `state.json` and projected by an `alert-changed` event             |
| pipe connected                | the registry in `app/pipes.ts` (open pipe streams), projected onto the session by a `pipe-changed` event           |
| last pipe connection          | `pipes` in `state.json`: session id to the last time a pipe was connected, replayed at boot                        |
| shown                         | garden's stage state in `state.json`, not a session fact at all                                                    |

The exceptions: `session-registered` clears `ended` because a process was just started under that
id, which is how resume revives an ended session. It also supplies the cwd, as does a hook payload
when the cwd is still empty. And a hook for an id garden has not seen creates the session
(`blank(id)`), so a session started outside garden appears on its first hook, before its
transcript is read.

Whether a pane socket is open for a session is not session state. It is bookkeeping in
`app/attach.ts` that refuses a second concurrent attach; the client learns a session is already
on stage from `shown`.

The recap comes from the transcript only, though a `Stop` hook carries `last_assistant_message`
and would be cheaper. One source makes the recap the same for a session garden started, one it
did not, and one it sees for the first time after a restart; a hook-fed recap would exist for
some sessions and not others, by a rule no reader could predict. `reduce` ignores the hook field.

A session has three axes. Status depends on liveness; shown is independent of both.

- **Liveness**, `live` or `dead`: does tmux report a live pane for this session? garden asks tmux
  and believes the answer. A session garden never started, or whose tmux session is gone, is
  `dead` and offered Resume. `exitCode` and `tmuxName` are fields of a dead session, not states:
  the exit code exists only while tmux still holds the dead pane (`remain-on-exit`), and a held
  tmux session is what lets Resume reuse the pane (§4.5).
- **Status**, only while live: `reduce.ts` sets a dead session's status to null, not `unknown`.
  `unknown` means live with no reported status since boot. Pending Codex sessions recover as
  `waiting`; the next status-bearing signal updates either report.
- **Shown**: whether the session sits in a stage slot. A dead session can be shown (its pane
  renders a dead placeholder with a Resume button), and a live one can be unshown.

The accepted cost of asking tmux alone: a session running in a terminal garden does not own
reads `dead` and offers Resume, and taking it leaves two `claude --resume` processes appending to
one transcript. That is rare, and the user's discipline to keep.

## 2. Shape

Hexagonal, lightly applied: garden rules in a pure core, external protocols at the edges,
plus an explicit state projection at the centre. Purity alone does not make a function domain
logic: native harness hooks, transcript formats and command arguments belong to that harness
adapter, including their pure parsers and builders. The domain folds normalized garden facts.

Two things this deliberately is _not_. It is not DDD — there are no entities, aggregates, or
repositories, because nothing in garden has invariants worth defending. And there is no
dependency-injection container; a single composition root wires everything by hand.

Ports (TypeScript interfaces for outbound dependencies) exist only where something needs to be
faked in a test — realistically tmux, the store, the transcript watcher, git, `gh`, and the pty attach.
Everything else is imported concretely. An interface with one implementation and no test fake
is ceremony.

Ports are declared by the consumer, not the implementer: they live in `app/ports.ts`, and
adapters are written to satisfy them. That direction is what lets `app/` import nothing from
`adapters/` at all, which is a rule a linter can check.

## 3. Packages

A pnpm workspace:

| Package           | Role                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| `packages/shared` | The wire vocabulary. Types and pure helpers only, zero runtime dependencies. |
| `packages/server` | The daemon and the `garden` bin.                                             |
| `packages/web`    | The browser client.                                                          |

`shared` holds the shapes that cross the process boundary: `SessionState`, `Liveness`,
`Status`, `Delta`, and the request/response type for every endpoint. If the server and the
client ever disagree about a shape, it is because something bypassed this package.

## 4. Server

```
packages/server/src/
  domain/          pure. no node builtins, no libraries
    types.ts       GardenEvent, GardenState, TranscriptRecord, TmuxSessionFact, ReportedStatus
    reduce.ts      reduce(state, event) -> state
    sessions.ts    deriveLiveness(fact) -> liveness, exit code
    stage.ts       slot arithmetic across preset changes
    watches.ts     watch rules: kind normalisation, upsert/remove, 7-day digest pruning, summaries
    pipes.ts       ack a digest, end watches with no pipe for 7 days, prune stale pipe times
    github.ts      REST JSON -> PR facts, and the gh port's read and write result types
    pollCursor.ts  the poller's cursor (ids, ETags, counts; no PR content) and the diffs over it
    digest.ts      fold observed activity into a watch: kinds, quiet window, digest line and detail
    paths.ts       filesystem scoping
    diff.ts        (prev, next) -> Delta[]
  adapters/        one external system each
    tmux.ts        execFile wrapper: list, new-session, respawn-pane, kill, version check
    git.ts         git-common-dir, branch (read from HEAD, no spawn), status --porcelain, worktree prefix, origin URL
    gh.ts          a conditional `gh api` GET (ETag in, `--include` output parsed, rate-limit resume time, classified result out) and one DELETE that removes a review request
    transcripts.ts generic polling over a harness-supplied layout and record reader
    claude/ / codex/  native hook/transcript translation, command builders, overlay and display names
    fsWatch.ts     native recursive fs.watch on one root, debounced, .git/ filtered
    pty.ts         node-pty attach
    store.ts       <appDir>/state.json, atomic writes (overlay only)
    logger.ts
  app/
    ports.ts       interfaces app requires: TmuxPort, StorePort, TranscriptPort, PtyPort, GitPort,
                   GhPort, FsWatchPort, HarnessPort
    projection.ts  owns current state; dispatch(event); subscribe(fn)
    sessions.ts    create / resume / kill use cases
    hooks.ts
    watches.ts     add / remove / list watch use cases and boot replay, all through one writer
    pipes.ts       registry of open pipe streams: connect, ack, close, hourly sweep, boot replay
    poller.ts      fetch a watch's PR activity; the loop that merges it through that writer
    reviews.ts     in-memory review queue store; a dismissed key stays hidden until a complete poll drops it
    reviewDismiss.ts  the dismiss use case: remove the user's review request on GitHub, then the queue item
    reviewPoller.ts  the loop that searches GitHub for review requests and feeds that store
    filesystem.ts
    repos.ts
    rootWatch.ts   one watch per /events connection, swapped on a new root
  http/
    routes/        fastify route handlers
    ws/            events socket, attach socket, pipe socket
    errors.ts      error-class-to-status table and the fastify error handler
    server.ts      fastify factory
  config.ts        resolves appDir, transcriptsDir, tmuxSocket, claudeCommand from GARDEN_*
                   env vars, else their ~/.garden-claude / ~/.claude / claude defaults
  appdir.ts        writes tmux.conf under appDir
  main.ts          composition root
  cli/             the garden bin
```

Repo grouping and pin ordering are not server-side: that logic lives in
`packages/web/src/features/sidebar/groupSessions.ts`, run client-side against the session map.

Spawning a process blocks the server's event loop on macOS (`posix_spawn` is synchronous, and
endpoint security can push it to ~15ms each), so a spawn per cwd or per session on every tick grows
with session count. Read state the external system keeps on disk instead, as `git.ts` does for HEAD.

The server ships as a single esbuild bundle, and `node-pty`'s native addon cannot be bundled
(`packages/server/build.ts` says how it is kept external). The consequence: `dist/` only runs where
`node_modules/node-pty` resolves from it — in practice the checkout after `pnpm install`, with the
`garden` bin linked from it (README, "Dev loop"). Nothing copies `prebuilds/` into `dist/`, so a
relocatable install would have to. The version is pinned exactly; `pnpm-workspace.yaml` says why.

### Harness boundary

Each instance selects one harness at boot. The selection resolves the port, tmux socket and
app directory together; CLI commands and spawned panes use that full resolution. See
[Configuration](../README.md#configuration) for selection, defaults and overrides.

`HarnessPort` in `app/ports.ts` is selected in `main.ts`. It owns spawn and resume argv
(including model, effort and permission mode), the per-process hook overlay, native hook
validation and translation, transcript listing/path acceptance/record reading, session metadata,
and the status to register at launch. Native protocol translation belongs to the selected harness adapter, including pure parsers
and command builders. App code sees only its `HarnessPort`; `main.ts` supplies the adapter.
Adapters satisfy consumer ports structurally, without importing `app/`.

The reducer consumes Garden-facing keys in transcript records and `HarnessSignal`s without
interpreting native identity. Codex translates native thread ids through its alias store;
Claude retains its existing transcript/discovery ids and uses the native hook id when no
Garden header is present. Signals without a status preserve the last report. The signal
contract lives in `domain/types.ts`; the hook route keeps `/hooks` and `X-Garden-Session`
and delegates validation to the harness.

Garden's id remains the primary key. The Codex adapter persists pending and bound aliases in
its app directory and binds native ids and rollout paths from `SessionStart`, including after
clear or fork. Pending aliases preserve never-prompted sessions; ended sessions keep their
aliases for resume. The alias stores a project-based session handle across native bindings.
Spool replay recovers bindings posted while garden was down. Codex reads
only bound rollouts, and invalidates reads when a binding changes, including reads during boot.
It never discovers identities by scanning rollouts. Claude retains its project-slug discovery
and bounded head/tail reads. Generic polling receives the selected layout instead of knowing
either native format.

Codex's terminal and backend run as a pair under a tmux-owned launcher. Each backend has
its own private Unix socket and inherits that session's environment and hook overlay, so hook
identity stays scoped to the session. The launcher waits for the backend before starting the
terminal and stops the pair when either exits. Garden disconnects its passive observer on
shutdown without stopping either process.
Message delivery uses the same backend through native `codex queue`.

The observer reconciles the alias-bound thread's status on connect and follows native status
notifications. Internal threads are ignored. Pending approvals remain pending until the native
status clears them; tool hooks cannot overwrite that report. Connection loss invalidates the
report, and reconnect obtains a fresh snapshot. Binding changes and endpoint generations reject
late events. The observer never answers approval requests; those belong to the native terminal.
A bound session without a matching backend endpoint reports `unknown`. Sessions launched without a
backend must be ended and resumed to acquire one.

The same connection reads the thread name on connect and receives native rename notifications.
The metadata refresh also reads Codex's session index for the alias-bound thread, including renames
from other backends. It uses the indexed title before the backend connects and when the index has a
later timestamp than the last live observation. The live title survives a disconnect and a missing
or stale index entry.
The reducer retains the transcript fallback independently and clears both title sources when the
alias binds a different conversation. The Garden handle stays with the alias.

### 4.1 The projection is the spine

`app/projection.ts` owns the session state map and is the **only** writer of it.

```ts
dispatch(event) // reduce(state, event) -> diff(prev, next) -> notify subscribers
subscribe(fn) // the events WebSocket subscribes; so does anything else that cares
```

Adapters never mutate projection state. They own their I/O bookkeeping, including Codex
bindings; only projection dispatch changes Garden session state. They emit events:

- the transcript watcher emits `{ type: 'transcript-changed', path, record }`
- the harness adapter translates a hook into `{ type: 'harness-signal', signal }`
- a tmux poll emits `{ type: 'tmux-snapshot', sessions }`

`/events` carries the projection's deltas plus the global `ui-state` and `reviews` messages, and
one more pair that is not projection state. A client sends `{ type: 'watch', root }`
to watch a project root, and the server answers `{ type: 'fs-changed', root }` to that connection
alone. Those travel beside the projection (`app/rootWatch.ts`, via `adapters/fsWatch.ts`) and never go
through `reduce`: a file change is a hint to refetch, not session state.

Nothing in `domain/` reads the current time. The only timestamp any event carries is the one the
transcript's own last timestamped line holds, and that is display data no derivation reads. Liveness asks
tmux what is true now and believes the answer, so the same events produce the same state whenever
they are folded — which is what makes `reduce` a pure function of its arguments and testable as
one.

Commands are asymmetric and this matters: a use case calls the outside world first, then
dispatches the resulting fact. `createSession` runs tmux, and only then dispatches the id-to-name
mapping. It does not optimistically mutate state and hope tmux agrees.

### 4.2 Boot, and what is persisted

`<appDir>/state.json` holds **overlay facts only** — things garden itself decided and cannot
recompute: the session id to tmux name map, group order, and per-project pins, collapsed state
and hide-dead toggle, plus stage preset and slot assignments and focused slot, plus swarm
records and per-session parent/swarmId placements, plus the PR watches, each session's open alert the last time each
session had a pipe connected, and the review requests a session was started for. The file is versioned (currently 2): the UI state sits under `ui` as the
client's `UiState`, next to `tmuxNames` and the non-UI records, and a version 1 file is migrated on
read. It does **not** hold a `SessionState` snapshot. Session facts are derived at boot —
liveness and exit code from tmux, conversation facts from transcripts, branch from a live git
lookup keyed by cwd, and status from the selected harness's live signal source. Separately, `adapters/codex/index.ts` persists identity
bindings and pending launch cwd under `appDir`; replaying pending aliases preserves sessions
that have never produced a transcript, including their initial `waiting` report.

So the startup sequence is a replay, not a restore:

1. Read `config.json` and `state.json`. Write `tmux.conf` and `source-file` it into the tmux
   server if one is already running — a server that outlives a garden upgrade never re-reads it
   on its own. A failure here is logged, not fatal to boot. Construct the selected harness,
   loading its persisted identity state before transcript listing or hook replay.
2. Start the transcript watcher — before any dispatch below, so a write landing anywhere in
   this sequence still reaches it instead of being lost until the next unrelated event or a
   restart. It dispatches nothing for a file step 5 has already read, so the existing corpus is
   read once during boot rather than again by the watcher's first scan. A file created after
   step 5 took its listing is found by the first scan instead, up to ~10s later. Replay the
   harness binding spool before the projection replay so downtime bindings are available to
   transcript listing (`main.ts` drains it again on each tmux tick).
3. Dispatch `{ type: 'store-loaded' }` to load the id-to-name map; UI preferences remain in
   the overlay. Then replay the persisted watches: `replayWatches` runs the
   watch writer once, which prunes expired digests and closed watches (and persists that), and
   dispatches a `watches-changed` for every session holding watches. A failure here is logged,
   not fatal to boot. Then `replayAlerts` dispatches an `alert-changed` for every persisted alert,
   likewise logged on failure, and `pipes.replay()` dispatches a `pipe-changed` (not connected)
   for every persisted pipe time, likewise logged on failure.
4. Project pending harness sessions: Codex aliases with a stored tmux mapping are re-registered
   with `waiting`; those without one are projected as ended. Then dispatch a full
   `tmux-snapshot` and read harness session metadata, including titles from the Codex session index.
5. List the selected harness's transcript paths, reading files with bounded concurrency, and dispatch one
   `transcripts-replayed` holding every record in listing order. Its fold equals one
   `transcript-changed` per file but derives session state once, which is what keeps boot from
   growing quadratically with the corpus. Live transcript events arriving during the scan are held
   and dispatched after the batch, so an older record from the scan never overwrites a newer write.
6. Start the tmux poll; serve HTTP.
7. Once listening, sweep every session's cwd for its current branch and dispatch a
   `branch-resolved` per cwd (the tmux poll repeats the sweep on every tick). Sessions read
   `branch: null` until their cwd resolves, and the events socket delivers each branch as it lands.
8. Once listening, start the watch poller (`app/poller.ts`). It runs its own timer, reading
   `pollIntervalMinutes` before each cycle, and goes through the same watch writer as step 3, so
   each cycle also prunes expired watches. Beside it runs the review poller
   (`app/reviewPoller.ts`), a separate loop on the same interval with its own rate-limit hold,
   because the watch tick ends early on a rate limit and search is limited separately.

Steps 4 and 5 feed the same projection events used during normal operation; `main.ts` owns
the replay sequence. Transcript-recovered live sessions have `unknown` status until a status-bearing
signal; pending Codex sessions retain their replayed `waiting` report.

Transcripts are kept current by polling, not by native file watching: one `fs.watch` per file
costs more as the corpus grows (and hits `EMFILE`), and a scan is needed regardless because
native events drop. The adapter keeps a live set of transcript paths and runs two timers:

- **Live poll, every 1s.** Each live path is `stat`ed and reread only when its `(size, mtimeMs)`
  differs from what was last read. A live path whose file doesn't exist yet is skipped silently
  and picked up once it appears, because a session reports its path before its file exists.
- **Discovery scan, every ~10s.** The same diff over the paths listed by the selected harness
  layout. A new or changed file is reread and joins the live set. Claude lists in-scope project
  JSONL files; Codex lists only bound rollouts, so scanning cannot discover an unbound Codex
  conversation.

Hook signals supply live paths through `app/hooks.ts` and `LiveTranscripts.track`. The generic
watcher delegates path acceptance and record reading to the harness layout. For Claude, that
means `<transcriptsDir>/<in-scope slug>/<name>.jsonl`, excluding nested `subagents/` files whose
parent ids would corrupt the parent's record. For Codex, acceptance requires an existing
binding. `adapters/claude/` and `adapters/codex/` own these policies.

Garden does not derive a transcript path at spawn: hooks and the selected layout supply it.
A live path unchanged for 5 minutes leaves the live set; hooks re-track it, and a scan promotes
it on its next change. A Claude session garden did not start and has not heard a hook from
can take up to ~10s to appear through discovery. Codex requires a binding first. Hooks and native status observation update
status independently of transcript polling.

`readRecord`, which boot replay uses, and the watcher share one signature map, and each read
records the signature of the `stat` taken before it reads. So replay leaves the map filled, and
the first scan after boot rereads only what changed since. A write landing mid-read makes the
recorded signature stale, never ahead of the content, which costs one extra reread and never a
missed change.

The pipe sweep (`pipes.sweep`, hourly) does not run at boot: its first pass is one interval after
the server starts, so pipes whose server restarted have time to reconnect before the no-pipe rule
can end a watch. Each pass also re-stamps every connected session's time, so after a crash a
persisted time is at most one interval stale.

### 4.3 What goes in `http/`

Translation only: parse and validate the request, call one use case, serialise the result.
A route that contains an `if` about session state is in the wrong file. If you find yourself
wanting logic there, it belongs in `app/` (orchestration) or `domain/` (rules).

### 4.4 The CLI

`cli/` is a thin HTTP client against the local server, so the CLI and the browser drive one
code path. It does not import `app/` or `adapters/`, and it never shells out to tmux itself —
with one carve-out: `uninstall` and `stop --all` both kill the tmux server directly, because
each has to work with the garden server dead (`uninstall` after it stops the server itself,
`stop --all` as the last step of the same hard stop). Both share the one `killTmuxServer` call,
in `cli/tmux.ts`. `garden ls` is a `GET /sessions`.

`garden events --follow` is the one long-lived verb. It holds a WebSocket to the pipe stream,
reconnects for ever, and never exits on its own. Run as a Claude Code monitor, its stdout is a
socket whose other end the Claude process holds, so the CLI reads fd 1 (`cli/lifeline.ts`) and
treats EOF as the death of that process, even from SIGKILL; a signal alone would leave it orphaned.
Digest lines are the only thing it writes to stdout.

### 4.5 Create, resume, kill

`app/sessions.ts` holds the three commands. Create and resume follow §4.1's order: tmux first,
then dispatch `session-registered`. Kill dispatches `session-unregistered` after killing tmux. The
use cases never touch the store: `dispatch` persists the tmux name map itself, so the projection
is its only writer. Resume, kill, adopt and Codex send accept a Garden UUID or the exact current
projected name. The app prefers an exact ID, rejects ambiguous names with their matching IDs,
and carries the selected ID through the operation.

- **Create** mints a Garden id and asks the selected harness for launch preparation and a
  command. Claude uses `--session-id`; Codex persists a pending alias before launch and binds
  the native id through `SessionStart`. Registration uses the harness launch status, so a
  session is visible before any transcript exists.
- **Resume** asks the harness for its command: Claude uses `--resume <id>`; Codex resolves its
  bound native id or starts a still-pending session. tmux runs it by one of two mechanisms,
  chosen by whether it still holds the session. If it does (a dead pane kept by
  `remain-on-exit`), `respawn-pane` restarts it in place, keeping the tmux name, any attached pane and the stored mapping, so a pane on stage
  comes back where it sits. If not (a historical session, a killed one, a restarted tmux server),
  it creates a tmux session at the recorded cwd under a fresh name. The session id never changes,
  so the card keeps its identity either way, and the UI offers one Resume action for both.
- **Kill** kills the tmux session and dispatches `session-unregistered`, which drops the
  id-to-name mapping. The session is `dead` with no tmux name at once, through the reducer. The
  transcript remains, so the session stays listed and resumable. A deliberate kill also clears the
  session's alert; a session that dies on its own keeps it.

### 4.6 PR watches: store, poller, stream

Three pieces, each owning one thing.

- **Store.** Watch records live in the overlay, and `app/watches.ts` `updateWatches` is the only
  writer. Everything that changes a watch (the CLI verbs, the poller, an ack, the sweep, a `/clear` hook) goes
  through it. Hooks carry the pane's `GARDEN_SESSION_ID` in an `X-Garden-Session` header, because
  `/clear` gives the payload a new `session_id` while the pane env keeps the garden id.
- **Poller.** A `gh` adapter plus an `app/` poll loop observe pull requests and write digests into
  watches, only through `updateWatches`. It never talks to a pipe; it only changes the store.
- **Stream.** `app/pipes.ts` and the pipe socket in `http/ws/` deliver what the store holds. A
  connection is sent every pending digest on connect, and again after any watch write, because the
  registry subscribes to overlay writes (`projection.subscribeOverlay`). Watching the overlay
  rather than `watches-changed` is deliberate: a merge replaces one pending digest with another,
  which changes no `WatchSummary` and so dispatches nothing. Delivery is deferred a microtask,
  because the listener fires inside `updateWatches`, before that writer dispatches; sending inline
  would let a throwing send escape through the poller's merge and a synchronous ack nest a second
  write whose dispatch the outer one overwrites.

Delivery is at least once. A digest is cleared only by an `ack` from a connection that sent it, and
the CLI acks only after the line is written. The set of ids a connection has already sent is
connection-local and never persisted, so a reconnect, including after a server restart, resends
everything still pending. A watch whose session has had no pipe connected for seven days is ended
by the sweep.

Each minted digest also leaves a `DigestDetail` in the overlay's `digests` archive: the structured
items behind the line, built from the same tally that counts them, so the two cannot diverge. Only
`updateWatches` writes it (retention is 7 days from mint, newest 20 per watch), and
`GET /digests/:id` reads it, which is what `garden digest <id>` calls. It survives the ack.

## 5. Client

```
packages/web/src/
  state/
    sessionStore.ts   zustand. applyDelta is the only writer
    uiStore.ts        stage preset, slots, group order/pins, hide-dead — mirrors state.json
    localStore.ts     scroll positions, tree expansion, and other per-browser state
    settingsStore.ts  dead-session cap from GET /settings, loaded on startup
  api/
    client.ts         typed fetch wrappers
    eventSocket.ts    WS /events -> applyDelta
    paneSocket.ts     WS /attach/:id -> terminal bytes
  terminals/
    registry.ts       module-level Map<sessionId, PaneHandle>
  features/
    sidebar/  stage/  filetree/
  components/         presentational, props only
```

Server state is **read-only in the browser**. Components call `api/client.ts`; the change
arrives back as a delta and the UI re-renders. There are no optimistic writes and no
client-side prediction of a server transition, so the client and server cannot disagree and
there is no reconciliation code to get wrong. On localhost the round trip is a millisecond.

Two rules that follow: nothing outside `applyDelta` writes to `sessionStore`, and nothing
outside `api/` calls `fetch`.

Note that this covers more than it first appears. Stage preset, slot assignments, focused
slot, group order, pins, and collapsed groups all live in the server's `state.json`, so
dragging a group or switching preset is a command that round-trips like any other. Only
genuinely per-browser state — scroll offsets, tree expansion, and the like — lives in
`localStore.ts`.

### 5.1 The terminal registry, the one escape hatch

The stage layout is dockview rather than a hand-rolled CSS grid or react-mosaic. dockview's
`fromJSON(..., { reuseExistingPanels: true })` keeps a surviving pane's xterm and socket across a
preset switch, and its resize keeps proportions. react-mosaic remounts a tile when it changes depth.

xterm instances and their pane sockets are long-lived and imperative. They must survive
preset switches, maximise, and every React re-render, because remounting one drops the
socket and clears the screen.

So they live in `terminals/registry.ts`: a module-level map keyed by session id, outside
React's tree. React renders an empty container div; the registry attaches a terminal to it.
Panes hidden by maximise are hidden with CSS, never unmounted.

This is a real exception to declarative rendering, and it is named rather than hidden.
Confining it to one module is what keeps the rest of the client boring. Do not add a second
escape hatch without a reason as strong as this one.

## 6. Dependency rules

| Layer          | May import                                                                                                                           | Never                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `domain/`      | `shared`, other `domain/`                                                                                                            | node builtins, libraries, `adapters/`, `app/`, `http/`                                       |
| `adapters/`    | `shared`, pure `domain/` functions and types, its own library                                                                        | other adapters, `app/`, `http/`                                                              |
| `app/`         | `domain/`, `app/ports.ts`, `node:crypto`, `node:path`, `node:fs/promises` for one-shot reads (`readdir`, `stat`, `realpath`, `open`) | `http/`, `adapters/`, watchers and other long-lived fs resources (those live in `adapters/`) |
| `http/`        | `app/`, `shared`                                                                                                                     | `adapters/`, any business logic                                                              |
| `cli/`         | `shared`, an HTTP client                                                                                                             | `app/`, `adapters/`, `domain/` logic                                                         |
| `main.ts`      | everything                                                                                                                           | —                                                                                            |
| `packages/web` | `shared`                                                                                                                             | node builtins, tmux, the filesystem                                                          |

These are enforced by scoped `no-restricted-imports` rules in `eslint.config.js`, so a
violation fails `pnpm lint` with a message naming the rule. They are not honour-system
guidance — the value of "the core is pure" disappears the first time someone imports
`child_process` into it for one convenience.

Some rows are enforced only in part. In `app/`, lint does not police `node:fs`, so review
upholds the one-shot-reads line. In `domain/`, the lint rules block node builtins and the sibling layers,
but an arbitrary npm import into `domain/` still passes, because catching
that needs an allowlist of every permitted specifier. Treat "no libraries in `domain/`" as a
rule review has to hold up, and revisit the allowlist if it starts being broken.

The `http/` row's "any business logic" ban is not lint-enforced at all: `no-restricted-imports`
can only police what a file imports, not what it does with the result, so a route that imports
nothing but `app/` and `shared` can still contain an `if` about session state. That half of the
row is a rule for review to catch, not `pnpm lint`.

The server never parses terminal output. Status comes from Claude hooks or the bound Codex backend, session facts from
transcripts, liveness from tmux.

## 7. Errors

Adapters own the failure of the outside world. They throw typed errors; `app/` decides what
that means and `http/` maps it to a status code.

`reduce` never throws. A hook for an unknown session id is stored under that id anyway,
because the transcript may not exist yet. An unparseable transcript line is skipped — the pure
parser in the harness adapter returns the lines it could read plus a count of the ones it
could not, and `adapters/transcripts.ts` owns the logging and the once-per-file dedup that goes
with it. Reporting a problem is I/O; interpreting a native transcript line is protocol translation. Together these are the
rules that keep one malformed file from taking the whole console down.

The client renders degraded state rather than error dialogs — `unknown` status, a session
with no title, an empty tree. The event socket reconnects with backoff and reattaches on-stage panes.

`adapters/logger.ts` writes to the console until `main()` redirects it to `<appDir>/server.log`
right after the server starts listening — the point past which the CLI that spawned a detached
server may already have exited and closed its end of the stderr pipe. The redirect only happens
when `main()` is running as that detached server; `pnpm dev` / `pnpm dev:sandbox` run the same
`main()` attached to a developer's own terminal and keep their console-visible logging. `main()`
also arms a `process.stderr` write guard at boot, before the redirect and before anything can log,
so a write failure at any point in the server's lifetime is a dropped write instead of an
uncaught exception.

## 8. Testing boundaries

Detailed patterns live in the testing doc; what matters architecturally is which layer gets
which kind of test.

- **`domain/`** carries the bulk of the tests. They are a list of events and an expected
  state — no tmux, no filesystem, no clock. If a behaviour is hard to test here, it is
  usually because a decision leaked into an adapter.
- **`adapters/`** get integration tests against the real thing where one exists: `store.ts`
  and `transcripts.ts` exercise real temp-directory I/O, and `git.ts` has integration coverage
  against a real repository. `tmux.ts`'s pure version-parsing logic has a colocated unit test,
  but its execFile-wrapping session calls (list/new-session/respawn-pane/kill) have no test
  against a real tmux. `gh.ts` runs a real subprocess against a stub `gh` script, because the
  real one needs network and credentials.
- **`app/`** gets tests with faked adapters, covering orchestration order; the few that
  exercise one-shot `node:fs` reads use real temp directories (see `docs/testing.md`).
- **`http/`** gets a thin smoke pass. There is little to test in translation.
- **`packages/web`** tests pure state logic only. No browser end-to-end tests.

## 9. Adding a feature

A worked example — adding a "restart session" command. Touch files in this order:

1. `packages/shared` — the request/response type, and the delta if a new one is needed.
2. `domain/types.ts` — the event variant.
3. `domain/reduce.ts` — the state transition.
4. `domain/reduce.test.ts` — the transition, as events in and state out. Before the plumbing.
5. `adapters/tmux.ts` — the tmux call, if one is missing.
6. `app/sessions.ts` — the use case: call the adapter, dispatch the fact.
7. `http/routes/sessions.ts` — the route. Translation only.
8. `packages/web/src/api/client.ts` — the typed wrapper.
9. The component that calls it.

If a change does not fit that path, it is worth a moment's thought about whether it belongs
where you are putting it.

## 10. Rejected, so they are not reintroduced

- **Codex native thread ids as garden keys.** Codex ids can change on clear; its stable Garden
  aliases keep the projection, persistence and CLI contract independent of those changes.
  Claude retains its existing discovery identity model.
- **Discovering Codex identities by scanning rollouts.** Matching cwd and time can adopt an
  internal thread or the wrong conversation. SessionStart binds both ids directly; spooling
  handles downtime without a competing discovery path.
- **DDD entities, aggregates, repositories.** Nothing here has invariants to defend.
- **A DI container.** One composition root in `main.ts` is enough.
- **garden-owned ptys, or hooks installed in `~/.claude/settings.json`.** See §1.1.
- **A time-based `external` liveness.** Guessing from recent transcript activity that a session
  runs in a terminal garden does not own left the most recently used sessions unresumable after a
  reboot, and made the fold depend on the clock.
- **A hand-rolled stateful UI, or no framework.** Where a maintained library removes stateful UI
  code (dockview, zustand, xterm.js), use it; garden runs on localhost, so bundle size does not
  argue otherwise.
- **tmux control mode in place of node-pty.** It would mean writing a multiplexer client for an
  under-documented protocol.
- **Optimistic client writes.** They buy latency hiding on a localhost socket and cost a
  second copy of every state transition.
- **Parsing terminal output.** For anything, ever.
- **`fetch` in components, tmux in the client, logic in `http/`, cross-adapter imports.**
- **Business logic in the CLI.** It is an HTTP client.
