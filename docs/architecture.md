# garden — architecture

How this codebase is organised and why. Read this before adding code. It describes structure
and boundaries, not features — for what garden does, see `docs/specs/2026-09-03-garden-v1-design.md`.

## 1. The model everything follows from

garden has four sources of truth about the outside world:

- **tmux** — which sessions exist, which panes are alive, exit codes.
- **transcripts** — `<transcriptsDir>/*/*.jsonl` (default `~/.claude/projects`), appended live by Claude Code.
- **hooks** — Claude Code POSTs its hook events to the server.
- **clients** — the browser and the CLI issue commands.

All four fold into one thing: a map of session id to session state. That map streams to
browsers as a snapshot on connect, then as deltas.

Every layer in this codebase exists to serve that sentence. Adapters turn the outside world
into events. One pure function folds events into state. One diff turns state changes into
deltas. If you are unsure where code belongs, ask which of those three jobs it is doing.

The hard part of garden is not any individual feature — it is that those four sources are
unsynchronised. A hook arrives before the transcript file exists. A pane dies while a client is
attached. The server restarts and has to re-associate session ids to tmux names. A hook reporting
`working` lands after tmux has already seen the pane die. Keeping that folding logic in one pure,
testable place is the central architectural decision here, and most of the rules below follow from
protecting it.

## 2. Shape

Hexagonal, lightly applied: a pure core with I/O pushed to the edges, plus an explicit state
projection at the centre.

Two things this deliberately is _not_. It is not DDD — there are no entities, aggregates, or
repositories, because nothing in garden has invariants worth defending. And there is no
dependency-injection container; a single composition root wires everything by hand.

Ports (TypeScript interfaces for outbound dependencies) exist only where something needs to be
faked in a test — realistically tmux, the store, the transcript watcher, git, and the pty attach.
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
    paths.ts       filesystem scoping
    diff.ts        (prev, next) -> Delta[]
  adapters/        one external system each
    tmux.ts        execFile wrapper: list, new-session, respawn-pane, kill
    git.ts         git-common-dir, branch, status --porcelain, worktree prefix
    transcripts.ts chokidar watch + read
    pty.ts         node-pty attach
    store.ts       <appDir>/state.json, atomic writes (overlay only)
    logger.ts
  app/
    ports.ts       interfaces app requires: TmuxPort, StorePort, TranscriptPort, PtyPort, GitPort
    projection.ts  owns current state; dispatch(event); subscribe(fn)
    sessions.ts    create / resume / kill use cases
    hooks.ts
    filesystem.ts
    repos.ts
  http/
    routes/        fastify route handlers
    ws/            events socket, attach socket
    server.ts      fastify factory
  config.ts        resolves appDir, transcriptsDir, tmuxSocket, claudeCommand from GARDEN_*
                   env vars, else their ~/.garden / ~/.claude / claude defaults
  appdir.ts        writes tmux.conf and the Claude hook-settings overlay under appDir
  main.ts          composition root
  cli/             the garden bin
```

Repo grouping and pin ordering are not server-side: that logic lives in
`packages/web/src/features/sidebar/groupSessions.ts`, run client-side against the session map.

The server ships as a single esbuild bundle, which constrains one adapter: `node-pty` has a
native addon that cannot be bundled — the build succeeds and then fails at runtime looking for
`pty.node` relative to the bundle. `adapters/pty.ts` is wired into `main.ts`, `node-pty` is a
dependency, and the bundle marks it external. What is still undecided is how the native addon
reaches `dist/` — shipping `node_modules` alongside, or copying the platform's `prebuilds/`
directory into it. It is a distribution decision, not a layering one, but it is cheaper to know
now than to discover at attach time.

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
recompute: the session id to tmux name map, group order and pins, collapsed groups, stage
preset and slot assignments, focused slot, and the hide-dead toggle. It does **not** hold a
`SessionState` snapshot. Every session fact is derived on every boot — liveness, exit code and
tmux name from tmux, cwd, branch, title and recap from the transcripts, status from hooks —
because those are the sources of truth and a persisted copy of them can only be wrong.

So the startup sequence is a replay, not a restore:

1. Read `config.json` and `state.json`.
2. Dispatch `{ type: 'store-loaded' }` — the projection now knows the id-to-name map and the
   UI preferences, and nothing else.
3. Dispatch a full `tmux-snapshot`.
4. Scan `<transcriptsDir>/**` and dispatch a `transcript-changed` per file.
5. Start the watcher and the tmux poll; serve HTTP.

Nothing is reconciled by hand, because steps 3 and 4 are the same events the adapters emit
during normal operation — boot is just the first batch of them. A live session recovered this
way has `unknown` status until its next hook event, which is correct rather than a limitation.

### 4.3 What goes in `http/`

Translation only: parse and validate the request, call one use case, serialise the result.
A route that contains an `if` about session state is in the wrong file. If you find yourself
wanting logic there, it belongs in `app/` (orchestration) or `domain/` (rules).

### 4.4 The CLI

`cli/` is a thin HTTP client against the local server, so the CLI and the browser drive one
code path. It does not import `app/` or `adapters/`, and it never shells out to tmux itself —
with one carve-out: `uninstall` kills the tmux server directly, because it has to work when
the garden server is not running to do it. `garden ls` is a `GET /sessions`.

## 5. Client

```
packages/web/src/
  state/
    sessionStore.ts   zustand. applyDelta is the only writer
    uiStore.ts        stage preset, slots, group order/pins, hide-dead — mirrors state.json
    localStore.ts     scroll positions, tree expansion, and other per-browser state
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

| Layer          | May import                                 | Never                                                  |
| -------------- | ------------------------------------------ | ------------------------------------------------------ |
| `domain/`      | `shared`, other `domain/`                  | node builtins, libraries, `adapters/`, `app/`, `http/` |
| `adapters/`    | `shared`, `domain/` types, its own library | other adapters, `app/`, `http/`                        |
| `app/`         | `domain/`, `app/ports.ts`                  | `http/`, `adapters/`                                   |
| `http/`        | `app/`, `shared`                           | `adapters/`, any business logic                        |
| `cli/`         | `shared`, an HTTP client                   | `app/`, `adapters/`, `domain/` logic                   |
| `main.ts`      | everything                                 | —                                                      |
| `packages/web` | `shared`                                   | node builtins, tmux, the filesystem                    |

These are enforced by scoped `no-restricted-imports` rules in `eslint.config.js`, so a
violation fails `pnpm lint` with a message naming the rule. They are not honour-system
guidance — the value of "the core is pure" disappears the first time someone imports
`child_process` into it for one convenience.

One row is enforced only in part: the lint rules block node builtins and the sibling layers
out of `domain/`, but an arbitrary npm import into `domain/` still passes, because catching
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

## 8. Testing boundaries

Detailed patterns live in the testing doc; what matters architecturally is which layer gets
which kind of test.

- **`domain/`** carries the bulk of the tests. They are a list of events and an expected
  state — no tmux, no filesystem, no clock. If a behaviour is hard to test here, it is
  usually because a decision leaked into an adapter.
- **`adapters/`** get integration tests against the real thing where one exists: `store.ts`
  and `transcripts.ts` exercise real temp-directory I/O; `tmux.ts` and `git.ts` have no tests
  yet.
- **`app/`** gets tests with faked adapters, covering orchestration order.
- **`http/`** gets a thin smoke pass. There is little to test in translation.
- **`packages/web`** tests pure state logic only. No browser end-to-end tests in v1.

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
- **Optimistic client writes.** They buy latency hiding on a localhost socket and cost a
  second copy of every state transition.
- **Parsing terminal output.** For anything, ever.
- **`fetch` in components, tmux in the client, logic in `http/`, cross-adapter imports.**
- **Business logic in the CLI.** It is an HTTP client.
