# garden — architecture

How this codebase is organised and why. Read this before adding code. It describes structure,
boundaries and the invariants behind them, not features: what garden does is in the code and
`packages/shared`, and planned work is in GitHub issues.

## 1. The model everything follows from

garden has four sources of truth about the outside world:

- **tmux** — which sessions exist, which panes are alive, exit codes.
- **transcripts** — `<transcriptsDir>/*/*.jsonl` (default `~/.claude/projects`), appended live by Claude Code.
- **hooks** — Claude Code POSTs its hook events to the server.
- **clients** — the browser and the CLI issue commands.

All four fold into one thing: a map of session id to session state. That map streams to
browsers as a snapshot on connect, then as deltas. There are two exceptions, both outside the
delta stream. One is a client's inbound `watch` message and the `fs-changed` it earns: a
per-connection filesystem watch, answered to that connection only. The other is the per-session
pipe stream (`WS /sessions/:id/events`), which pushes PR-watch digest lines to a `garden events
--follow` process and takes acks back (§4.6).

Every layer in this codebase exists to serve that sentence. Adapters turn the outside world
into events. One pure function folds events into state. One diff turns state changes into
deltas. If you are unsure where code belongs, ask which of those three jobs it is doing.

The hard part of garden is not any individual feature — it is that those four sources are
unsynchronised. A hook arrives before the transcript file exists. A pane dies while a client is
attached. The server restarts and has to re-associate session ids to tmux names. A hook reporting
`working` lands after tmux has already seen the pane die. Keeping that folding logic in one pure,
testable place is the central architectural decision here, and most of the rules below follow from
protecting it.

### 1.1 Invariants

Three decisions shape the whole system and are expensive to reverse. Check the reason before
changing one.

- **tmux is the supervisor; garden is disposable.** Every Claude Code process runs in a tmux
  session on garden's own socket (`tmux -L garden`, started with the conf `appdir.ts` writes).
  Killing the server or closing the browser never touches a session. Had garden owned the ptys,
  every session would die with the server, and you could not reach a session from another
  terminal with `tmux -L garden attach -t <name>`. Reversing this rewrites the process model,
  resume and the liveness derivation.
- **Pure overlay on Claude Code.** The garden server reads transcripts and receives hook calls,
  but writes nothing under `~/.claude/`; everything it writes lives in `appDir`. Its hooks reach
  Claude Code per process, through `--settings <appDir>/claude-settings.json` on the spawn
  command, rather than through `~/.claude/settings.json`, so they stay out of sessions garden did
  not start. The opt-in plugin in `plugins/garden`, whose hooks run in every session once enabled,
  is installed by Claude Code and is separate from this. If a server task seems to need a write
  under `~/.claude/`, stop and ask — there is no silent fallback.
- **Loopback only, no auth.** The server listens on `127.0.0.1`; `HOST` in `config.ts` is a
  constant, not a setting. Nothing authenticates a request, and the `/fs` endpoints serve file
  contents scoped only by session cwd, which is not strong enough to expose to a network.
  Supporting remote access means designing authentication first.

### 1.2 What a session's state is made of

Each fact has one primary source, with three exceptions below the table. `domain/reduce.ts`
merges them; nothing else computes a session fact.

| Fact                                 | Source                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| id, cwd, title, recap, last activity | transcript (a just-spawned session exists from its `session-registered` event until the transcript appears) |
| tmux name                            | the id-to-name map in `state.json`, written by `dispatch` when a session is (un)registered                  |
| liveness, exit code                  | tmux pane facts (`pane_dead`, `pane_dead_status`), overridden to dead by `ended`                            |
| `ended`                              | hooks: `SessionEnd` sets it, `SessionStart` clears it; `session-registered` also clears it                  |
| status, reason                       | hooks (`domain/status.ts` holds the event-to-status mapping)                                                |
| branch                               | a live git lookup by cwd (`app/branches.ts`), re-asked each tick for live sessions                          |
| repo root                            | `git rev-parse --git-common-dir` on the cwd (`app/repoRoots.ts`), so worktrees fold into their main repo    |
| Claude-side name                     | Claude Code's session registry, `~/.claude/sessions` (read only)                                            |
| watches                              | the watch records in `state.json`, projected onto the session by a `watches-changed` event                  |
| pipe connected                       | the registry in `app/pipes.ts` (open pipe streams), projected onto the session by a `pipe-changed` event    |
| last pipe connection                 | `pipes` in `state.json`: session id to the last time a pipe was connected, replayed at boot                 |
| shown                                | garden's stage state in `state.json`, not a session fact at all                                             |

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
  `unknown` means live but no hook heard since the server started, and clears on the next one.
- **Shown**: whether the session sits in a stage slot. A dead session can be shown (its pane
  renders a dead placeholder with a Resume button), and a live one can be unshown.

The accepted cost of asking tmux alone: a session running in a terminal garden does not own
reads `dead` and offers Resume, and taking it leaves two `claude --resume` processes appending to
one transcript. That is rare, and the user's discipline to keep.

## 2. Shape

Hexagonal, lightly applied: a pure core with I/O pushed to the edges, plus an explicit state
projection at the centre.

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
    transcript.ts  jsonl line -> session record
    status.ts      hook event -> status
    stage.ts       slot arithmetic across preset changes
    watches.ts     watch rules: kind normalisation, upsert/remove, 7-day digest pruning, summaries
    pipes.ts       ack a digest, end watches with no pipe for 7 days, prune stale pipe times
    github.ts      REST JSON -> PR facts, and the gh port's result type
    pollCursor.ts  the poller's cursor (ids, ETags, counts; no PR content) and the diffs over it
    digest.ts      fold observed activity into a watch: kinds, quiet window, digest line and detail
    paths.ts       filesystem scoping
    diff.ts        (prev, next) -> Delta[]
  adapters/        one external system each
    tmux.ts        execFile wrapper: list, new-session, respawn-pane, kill, version check
    git.ts         git-common-dir, branch (read from HEAD, no spawn), status --porcelain, worktree prefix, origin URL
    gh.ts          one conditional `gh api` GET: ETag in, `--include` output parsed, rate-limit resume time, classified result out
    transcripts.ts chokidar watch + read
    fsWatch.ts     native recursive fs.watch on one root, debounced, .git/ filtered
    pty.ts         node-pty attach
    store.ts       <appDir>/state.json, atomic writes (overlay only)
    logger.ts
  app/
    ports.ts       interfaces app requires: TmuxPort, StorePort, TranscriptPort, PtyPort, GitPort,
                   GhPort, FsWatchPort
    projection.ts  owns current state; dispatch(event); subscribe(fn)
    sessions.ts    create / resume / kill use cases
    hooks.ts
    watches.ts     add / remove / list watch use cases and boot replay, all through one writer
    pipes.ts       registry of open pipe streams: connect, ack, close, hourly sweep, boot replay
    poller.ts      fetch a watch's PR activity; the loop that merges it through that writer
    filesystem.ts
    repos.ts
    rootWatch.ts   one watch per /events connection, swapped on a new root
  http/
    routes/        fastify route handlers
    ws/            events socket, attach socket, pipe socket
    errors.ts      error-class-to-status table and the fastify error handler
    server.ts      fastify factory
  config.ts        resolves appDir, transcriptsDir, tmuxSocket, claudeCommand from GARDEN_*
                   env vars, else their ~/.garden / ~/.claude / claude defaults
  appdir.ts        writes tmux.conf and the Claude hook-settings overlay under appDir
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

### 4.1 The projection is the spine

`app/projection.ts` owns the session state map and is the **only** writer of it.

```ts
dispatch(event); // reduce(state, event) -> diff(prev, next) -> notify subscribers
subscribe(fn); // the events WebSocket subscribes; so does anything else that cares
```

Adapters never touch state. They emit events:

- the transcript watcher emits `{ type: 'transcript-changed', path, record }`
- the hook route emits `{ type: 'hook', payload }`
- a tmux poll emits `{ type: 'tmux-snapshot', sessions }`

`/events` is projection-only except for one pair of messages. A client sends `{ type: 'watch', root }`
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
records and per-session parent/swarmId placements, plus the PR watches and the last time each
session had a pipe connected. It does **not** hold a
`SessionState` snapshot. Every session fact is derived on every boot — liveness and exit code
from tmux, cwd, title and recap from the transcripts, branch from a live git lookup
keyed by cwd, status from hooks — because those are the sources of truth and a persisted copy
of them can only be wrong.

So the startup sequence is a replay, not a restore:

1. Read `config.json` and `state.json`. Write `tmux.conf` and `source-file` it into the tmux
   server if one is already running — a server that outlives a garden upgrade never re-reads it
   on its own. A failure here is logged, not fatal to boot.
2. Start the transcript watcher — before any dispatch below, so a write landing anywhere in
   this sequence still reaches it instead of being lost until the next unrelated event or a
   restart. Its own initial scan dispatches nothing (`ignoreInitial`), so the existing corpus is
   read once during boot, by step 5, rather than by the watcher's own scan as well — see the
   reconciliation paragraph below for what that trades away. One gap: a file created while that
   scan is still walking the tree, after step 5 has already taken its own listing, is discovered
   by the scan rather than as a live event, so `ignoreInitial` suppresses it too — neither step 5
   nor the watcher dispatches it, and it surfaces on the first reconciliation pass instead, up to
   ~10s later rather than immediately.
3. Dispatch `{ type: 'store-loaded' }` — the projection now knows the id-to-name map and the
   UI preferences, and nothing else. Then replay the persisted watches: `replayWatches` runs the
   watch writer once, which prunes expired digests and closed watches (and persists that), and
   dispatches a `watches-changed` for every session holding watches. A failure here is logged,
   not fatal to boot. Then `pipes.replay()` dispatches a `pipe-changed` (not connected) for every
   persisted pipe time, likewise logged on failure.
4. Dispatch a full `tmux-snapshot`.
5. Scan `<transcriptsDir>/**`, reading files with bounded concurrency, and dispatch one
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
   each cycle also prunes expired watches.

Nothing is reconciled by hand for steps 4 and 5, because they carry the same facts the adapters
emit during normal operation — boot is just the first batch of them. A live session recovered
this way has `unknown` status until its next hook event, which is correct rather than a
limitation.

The watcher itself does carry one reconciliation of its own: alongside chokidar's native watch,
it runs a periodic rescan (every ~10s) that diffs every in-scope transcript file's `(size,
mtimeMs)` against what was last read — by either path, since a native-watch read and a
reconciliation read share one cache — and rereads anything new or changed. This backstops a real
gap in chokidar's own guarantees — its `'ready'` event proves the transcripts directory's own
watch is registered, but not that every session subdirectory's watch is armed too, because
chokidar scans a newly created directory's contents before it registers that directory's own
native watch handle. A rapid write landing in that narrower window would otherwise go unnoticed
until something else touches the file or the server restarts. Because the initial scan no
longer seeds this cache, it starts empty at boot, so the first reconciliation pass (~10s in,
after HTTP is already serving) reads every in-scope file once; later passes are incremental as
usual.

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
is its only writer.

- **Create** mints the session id and passes it to `claude --session-id`, so garden knows the id
  before any transcript exists. The transcript watcher picks the session up once Claude Code
  writes it.
- **Resume** runs `claude --resume <id>` by one of two mechanisms, chosen by whether tmux still
  holds the session. If it does (a dead pane kept by `remain-on-exit`), `respawn-pane` restarts it
  in place, keeping the tmux name, any attached pane and the stored mapping, so a pane on stage
  comes back where it sits. If not (a historical session, a killed one, a restarted tmux server),
  it creates a tmux session at the recorded cwd under a fresh name. The session id never changes,
  so the card keeps its identity either way, and the UI offers one Resume action for both.
- **Kill** kills the tmux session and dispatches `session-unregistered`, which drops the
  id-to-name mapping. The session is `dead` with no tmux name at once, through the reducer. The
  transcript remains, so the session stays listed and resumable.

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
| `adapters/`    | `shared`, `domain/` types, its own library                                                                                           | other adapters, `app/`, `http/`                                                              |
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

The server never parses terminal output. Status comes from hooks, session facts from
transcripts, liveness from tmux.

## 7. Errors

Adapters own the failure of the outside world. They throw typed errors; `app/` decides what
that means and `http/` maps it to a status code.

`reduce` never throws. A hook for an unknown session id is stored under that id anyway,
because the transcript may not exist yet. An unparseable transcript line is skipped — the pure
parser in `domain/transcript.ts` returns the lines it could read plus a count of the ones it
could not, and `adapters/transcripts.ts` owns the logging and the once-per-file dedup that goes
with it. Reporting a problem is I/O; deciding a line is unusable is not. Together these are the
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
