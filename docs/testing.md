# Testing garden

How to decide what to test and where it goes. This document is deliberately **not** a list of
garden's tests — the colocated test files are the only record of what is covered, and a
document that duplicated them would be a second copy nobody updates. If you are looking for
what is tested, read the tests. If you are about to write one, read this.

For the layering these rules refer to, see `architecture.md`.

## The line between the tiers

Two tiers, unit and integration. There is no browser or end-to-end tier. `pnpm screenshot`
(see `scripts/screenshot.ts`) is a local dev tool for visually reviewing a UI change, not a
third tier — it asserts nothing and CI never runs it. Each run starts and stops its own vite, so it
leaves only the shared debuggable Chrome running.

The line is not "fast versus slow". It is **does the thing under test need a real OS resource
to fail for the right reason.** garden's entire risk surface sits at that boundary: a wrong
`tmux` argument array, a transcript read landing mid-append, a socket that outlives the test.

Logic that touches no process and no filesystem can be wrong in a thousand small ways, and a
plain function call exposes all of them — so it is a unit test no matter how trivial it looks.
Logic that _does_ cross a process boundary can pass every mocked test and still be wrong in
the only way that matters: the arguments were wrong, or the real tool did not behave as the
code assumed. That is what the integration tier is for, and it is why the tiers use different
infrastructure rather than different `describe` blocks.

## Where tests live and how they run

Unit tests are colocated `*.test.ts` files beside their source — `src/**/*.test.ts` inside each
package, plus a root `vitest.config.ts` collecting `scripts/**/*.test.ts` for the dev-tooling
scripts, so a test for a script can sit next to the script it covers instead of borrowing a
package's tier. Integration tests live in `packages/server/tests/integration/` under their own
vitest config with `fileParallelism: false` and raised timeouts — real tmux servers stepping on
each other and slow CI runners are what that config prevents.

A script that isn't a package and isn't dev-tooling — the garden plugin's hook scripts, say —
still needs somewhere to be tested that isn't `packages/server`, which has no relationship to
it, and isn't inside `plugins/garden/` itself, since that whole directory is copied into every
user's plugin cache and would ship its tests and fixtures along with it. Repo-level `tests/`
(also collected by the root `vitest.config.ts`) is that place. Whether such a test belongs in
the unit or integration tier still follows the line above, not the tier its neighbours happen
to use: the plugin's hook scripts need only `bash` and `jq`, not a tmux server, so their tests
run in the unit tier even though they spawn a real subprocess — "`execFile` is never mocked"
governs how a subprocess is exercised, not which tier gets to exercise it.

Each package's `vitest.config.ts` collects only its own `src/**/*.test.ts`, and the root config
only `scripts/**/*.test.ts` plus repo-level `tests/**/*.test.ts`, so a test under
`packages/server/tests/integration/` can never be collected by `pnpm test`. Every config runs
the `node` environment with `globals: false`, so every test file
imports `describe`, `it`, `expect`, `vi` explicitly. Small cost, and it keeps a test file's
dependencies visible at the top rather than ambient.

lefthook's pre-commit hook runs the unit tier only. That is not a speed shortcut — a commit
hook that spawns tmux servers makes committing depend on the developer's environment. CI runs
both tiers and builds tmux 3.6a from source for the second, since apt on `ubuntu-latest` ships
3.4. A green pre-commit tells you the logic holds, not that the tmux calls are right.

The integration tier needs tmux 3.6 or newer. Below that, `utempter_remove_record` resets
`SIGCHLD` to `SIG_DFL` around its own fork-and-wait, so the exiting pane's `SIGCHLD` is
discarded and `pane_dead_status` never gets set — `exitCode` never arrives (fixed in
[tmux/tmux#4559](https://github.com/tmux/tmux/issues/4559)).

## What each layer's tests look like

- **`domain/`** carries most of the suite. Events in, expected state out; no tmux, no
  filesystem, no clock. If a behaviour is hard to test here, a decision has leaked into an
  adapter — fix the leak rather than reaching for a mock.
- **`adapters/`** is the integration tier: tmux driven on an isolated socket, git driven in a
  temp repo. These tests exist to prove the argument arrays and the real tool's actual
  behaviour, which is the one thing no unit test can reach.
- **`app/`** tests orchestration order with faked ports. Use cases call the outside world
  first and dispatch the resulting fact second, and getting that backwards is the bug worth
  pinning: nothing should dispatch a fact the outside world never agreed to. Assert the call
  and the dispatch that followed, including the case where the port throws and nothing is
  dispatched. A port with no fake in a test here is ceremony.
  The exception is one-shot `node:fs` reads, which `app/` may call directly (see the dependency
  table in `architecture.md`): those use cases have no port to fake, so their unit tests run
  against real temp directories and stay in the unit tier.
- **`http/`** gets a thin smoke pass via `fastify.inject()`: mounted, bad body rejected before
  it reaches `app/`, typed error mapped to the intended status. If a route seems to need more
  than that, it is holding logic that belongs in `app/` or `domain/`.
- **`packages/web`** tests `applyDelta` — a function from store state and a delta to a new
  store state, so it tests exactly like `reduce` — plus the plain-function helpers each feature
  pulls out of its components: parsing, formatting, small derivations. Because `applyDelta` is
  the only writer of the session store, a suite over it covers every client state transition
  there is; a helper gets its own suite wherever a feature has logic worth pulling out of a
  component to test as a function over plain data.

## Invariants over examples

garden's architecture makes a few whole-system properties expressible as single assertions.
These are the highest-value tests in the project, because no per-function test catches what
they catch. Hand-written event sequences over the builders below — no property-testing
library.

**The delta round trip.** `applyDelta(prev, diff(prev, next))` must equal `next`. That is the
entire server-to-client contract in one line, and it catches the drift most likely to actually
happen: someone adds a field to `SessionState`, updates `diff`, and forgets `applyDelta`, so
the UI shows stale data for that one field. Per-function tests on both sides pass; this fails.

```ts
for (const events of sequences) {
  const next = events.reduce(reduce, prev);
  expect(applyDelta(prev, diff(prev, next))).toEqual(next);
}
```

**Boot replay equals steady state.** The same events — `store-loaded`, a `tmux-snapshot`, a
`transcripts-replayed` batch (equal to a `transcript-changed` per file) — must produce the same state whether they arrive at startup or
during a long-running session. `architecture.md` §4.2 claims boot is just the first batch of
ordinary events; this is what holds that claim to it.

**`reduce` is total.** `architecture.md` §7 promises it never throws, and every fact garden
holds flows through it, so that promise gets a test rather than a sentence. Without a
property-testing library this cannot be proven for all inputs, so make it a concrete, bounded
obligation instead: a table with every event variant crossed against the states that break
naive implementations — the empty state, a state where the event's session id is unknown, the
same event applied twice, and two events about one session arriving in either order. When you
add an event variant, you add a row. That is checkable in review, where
"for any event in any state" is not.

## Fixture builders

Build test data with small builders taking overrides — `aSession({ liveness: 'dead' })`,
`aHookEvent({ hook_event_name: 'Stop' })` — kept beside the code they describe. The point is
that each test shows its difference from the default instead of restating a whole object, so
the interesting field is the only one you read. When a type gains a field, the builder is the
one place that needs a default.

## Real versus faked

Fake as little as possible, and never fake the thing this project is most exposed to getting
wrong. A real Claude session is not an exception: driving a session through its status
transitions is not itself something to fake, and it does not need a real Claude either.
`scripts/fake-claude.ts` is the default for exercising that path, in both the integration tier
and manual sandbox use (`pnpm dev:sandbox:server` with `GARDEN_CLAUDE_COMMAND` pointed at it) —
a real spawned process behind a real tmux pane, moved between `working`, `needs-approval`,
`waiting` and `ended` by typed keywords (`/approve`, `/wait`, `/end`) rather than by waiting on
a live model's actual output. The process boundary, the pane, the hook POSTs and the transcript
file it writes are all still real; only the model's judgment is replaced, by a keyword mapping
deterministic enough to assert on.

- **`execFile` is never mocked, anywhere.** Faking a port substitutes one implementation of a
  declared interface; mocking `execFile` pretends the process boundary behaved. The test then
  passes because the mock returned what you told it to, while the argument array — the thing
  that decides whether `new-session` got the right `-c`, `-e`, and name — goes untested. To
  test argument-building logic, extract the decision into a pure function in `domain/` and
  test that; let the line that calls `execFile` be proven by an integration test.
- **tmux** has exactly one legitimate fake: the `TmuxPort` interface, faked at the `app/` tier
  to test orchestration without spawning anything. Adapter tests always drive the real binary
  on an isolated socket. `domain/` needs no tmux fake — tmux facts are plain data by the time
  derivation sees them.
- **Transcripts** use real files in a temp directory for the parser and the reconciliation
  backstop, which both do plain fs reads. The unit tier fakes chokidar itself (`vi.fn()` in
  place of `watch`, driven by hand-fired `add`/`change` events) to test debounce collapsing,
  the ignore predicate, and the reconciliation interval deterministically. Chokidar's own
  delivery — a read landing mid-append, an atomic replace — is real filesystem timing an
  in-memory fake can't reproduce, so only `tests/integration/fake-claude.test.ts` drives it,
  against a real watch.
- **Hook payloads** are the cheap case: plain JSON over HTTP. Use a builder, not a fake.
- If a unit test reaches for `vi.mock`, treat it as a signal rather than a tool — either the
  code under test imported an adapter it should not have, or the test belongs in the other
  tier. Passing a hand-written fake into a use case is not mocking; that is the port working.

## Running a sandbox

`pnpm dev:sandbox:server` boots an isolated garden: its own port, tmux socket and app dir, with
`scripts/fake-claude.ts` in place of Claude. It runs beside the user's real `garden` without
either seeing the other's sessions, which is what makes it safe for an agent to start one on its
own for a manual or visual check. Never start, stop, signal or reconfigure the real instance (the
default port, socket and app dir) to do the same job, because that is the user's live work.

A second sandbox needs its own port, tmux socket and app dir. The scripts take them as
`GARDEN_SANDBOX_PORT`, `GARDEN_SANDBOX_SOCKET` and `GARDEN_SANDBOX_APP_DIR`, plus
`GARDEN_SANDBOX_VITE_PORT` for `dev:sandbox:web`. They are deliberately not the `GARDEN_*` names
the server itself reads: garden injects `GARDEN_PORT` into every pane it spawns, so a script
honouring that name would silently point a sandbox started from inside a garden session at the
real instance's port. Sharing any of the server's three between two sandboxes puts them back in
each other's state.

An agent sets all three to values of its own, so it collides with neither the user's sandbox
(which runs on the defaults) nor another agent's. The setup script refuses a tmux socket that
already has live panes.

```
D=$(mktemp -d)
GARDEN_SANDBOX_PORT=<free port> GARDEN_SANDBOX_SOCKET=<unique name> GARDEN_SANDBOX_APP_DIR=$D \
  pnpm dev:sandbox:server
```

Run it in the background. It is ready when it logs `garden listening on
http://127.0.0.1:<port>`; if the command exits instead, its output says why.

Stop it when you are done, so nothing outlives the task. The sandbox writes no pid file, so
`garden stop` can't reach it; stop it by port and socket. Run the `kill` and the `kill-server`
only if you saw your own sandbox log `listening`. If it never came up, whatever holds that port
or socket belongs to someone else.

```
kill $(lsof -ti tcp:<port> -sTCP:LISTEN)   # the server exits within seconds, its pnpm parent with it
tmux -L <socket> kill-server
rm -rf $D
```

## The tmux integration fixture

The highest-risk piece of test infrastructure here. Get it wrong and a run leaks a server that
outlives the process — or worse, points at the developer's real `garden` socket and disturbs
their actual sessions. Isolation and cleanup both have to hold whether the test passes or not.

**Isolation.** A unique socket name per test, not per suite, so a previous crashed run's
leftovers cannot be inherited. The naming pattern is written literally in test code and never
derived from garden's own config or environment — that is the one guardrail making it
structurally impossible for a config resolution bug to point a test at the real socket.

**Options via a config file.** `remain-on-exit` has to be set when the tmux server _starts_,
so the fixture writes a small conf to a temp file and passes `-f <path>` on the first command
that touches the socket. That first command is what starts the server and reads the file. The
fixture's conf declares only what the tests check; mirroring the production conf line by line
would just be a second copy of it with its own drift.

**Guaranteed teardown.** Wrap creation and use so a thrown assertion still tears down:

```ts
export async function withTmuxServer(
  fn: (ctx: { socket: string; confPath: string }) => Promise<void>,
) {
  const socket = `garden-test-${randomBytes(4).toString('hex')}`;
  const dir = mkdtempSync(join(tmpdir(), 'garden-tmux-'));
  const confPath = join(dir, 'tmux.conf');
  writeFileSync(confPath, 'set-option -g remain-on-exit on\n');

  try {
    await fn({ socket, confPath });
  } finally {
    await execFileAsync('tmux', ['-L', socket, 'kill-server']).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}
```

A hard kill of the test process skips the `finally` and leaks a server; there is no way to
close that from inside the process being killed. The mitigation is that isolation makes the
leak harmless rather than preventing it — a stray `garden-test-a1b2c3d4` server is an idle
process nobody will attach to. Accepted residual risk, not a solved one.

**The same discipline applies to git.** A git adapter test runs `git init` in a fresh temp
directory and passes that path explicitly on every call. It never relies on the process cwd,
because the cwd during a test run is a real repo with real work in it — and a test that reads
or mutates it is both wrong and destructive. Create the temp repo, use it, remove it in a
`finally`, exactly as above. Any adapter that reaches a real OS resource needs its own fixture
following this shape: name the resource explicitly, never inherit it from the environment, tear
it down whether the test passed or not.

**The fake-Claude composition.** `tests/integration/fake-claude.test.ts` stacks a fourth real
thing on top of the socket fixture above: a long-lived spawned `tsx` process
(`scripts/fake-claude.ts`) running inside a pane on that socket, a live HTTP server, and a real
`watchTranscripts` watch over a temp directory, all at once. Nothing else in the suite composes
a real pane, a real long-lived process and a live server together — every other adapter test
drives one real resource at a time, which is why this one took iteration to get stable. The fake
prints a `READY` marker the instant its read loop actually attaches to stdin; the test polls for
that line with `until` before sending its first keyword, because `tmux send-keys` against a pane
whose process hasn't reached its read loop yet succeeds and delivers the keystroke nowhere, with
no error to catch it.

## Flake policy

**Poll with a deadline; never sleep.** State transitions in tmux are not synchronous with the
command that caused them — a pane reports dead some time after its process exits. A fixed
sleep is either too short (flaky) or too long (slow), and it encodes a guess about someone
else's timing. Poll the condition until a deadline and fail with what the last observation
actually was, so a timeout tells you what state it was stuck in.

The same rule applies to the watch path: assert that a change was picked up by waiting for it,
not by sleeping past it.

## What is deliberately not tested

**Declarations.** A test asserting a value the code states one line away has one failure mode:
a deliberate edit. Config defaults and literal lookup tables are the usual candidates. Where a
table sits next to real logic, test the behaviour around it — the transformations, the
precedence when two sources disagree, the initial-state default — not the table's entries.

**Anything in a browser.** garden's job is to get the right bytes to a pty and the right
dimensions on resize, which the integration tier proves directly. What xterm.js draws with
those bytes is xterm.js's contract with its own suite.

**Client logic that needs a DOM.** The vitest environment is `node`, not jsdom, so no client
logic can be tested by mounting a component — by construction. That is the intended forcing
function: if logic cannot be exercised as a plain function over plain data, extract it into
one rather than adding a DOM environment to reach it.

Two narrow exceptions exist, each with its own test a file must pass.

The first is a file whose subject _is_ DOM wiring, where extracting a pure function would leave
the part that actually breaks untested. Two files are the current instances. One pins a
third-party layout library's own documented-but-unverifiable behavior (identity preservation
across a `fromJSON`, for example), which belongs to the library rather than to garden's code. The
other is the terminal registry, garden's one imperative escape hatch, whose whole content is the
wiring between xterm, the fit addon, a `ResizeObserver` and a pane socket — reparenting a live
terminal on remount, handing the observer over, closing the right socket.

The second is a render-cost contract: a test may mount a single leaf component to pin that an
expensive child is not re-run on unrelated updates, with the expensive child mocked to count its
calls. `MarkdownBody.test.ts` is the current instance — the file viewer re-renders on every
`ui-state` echo, and the test pins that an unchanged file is not re-parsed.

Files in either category may declare `// @vitest-environment happy-dom` at their top;
`vitest.config.ts` stays on `node` for everything else.

Both categories are narrow. The render-cost one mounts a single leaf with its expensive child
mocked, never a feature component, and a pure decision inside either kind of file still belongs
outside it: the pane epoch reuse rule lives in `paneReuse.ts` and is tested under `node`. Logic
that can be exercised as a function over data is still extracted, per the forcing function above.

**Coverage as a number.** No threshold is enforced and none should be. A percentage cannot
distinguish the round-trip invariant from a test asserting a default port.

## Naming

A test name states the behaviour it pins — not the event, method, or document that prompted
it. `it('handles PermissionRequest')` names the input and says nothing about the expectation;
`it('marks a session needs-approval on a PermissionRequest hook')` gives you the assertion
without opening the body. This matters most on the subtle cases: `it('keeps a session dead when a
working hook arrives after tmux reported the pane dead')` names a precedence rule, where
`it('resolves conflicting state correctly')` has to be re-read every time.

Use the vocabulary the types use. Liveness is `live | dead`, asked of tmux alone; status is
`working | needs-approval | waiting | unknown` and belongs to live sessions only, a dead session
having none. A name that calls `dead` a status describes a state that cannot exist, and the reader
then has to go and find out what the test actually meant.
