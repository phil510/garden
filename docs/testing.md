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
leaves only the shared debuggable Chrome running. The `garden-sandbox` skill
(`.claude/skills/garden-sandbox/`) is the guide to driving a sandbox and capturing screenshots.

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
package's tier. Integration tests live at the repo level in `tests/integration/`, with their harness
in `tests/integration/support/`, under the root `vitest.integration.config.ts` with
`fileParallelism: false` and raised timeouts — real tmux servers stepping on each other and slow
CI runners are what that config prevents. The tier is repo-level because it is the only one that
drives real tmux and that constraint is machine-wide, so it isn't any one package's concern.

Plugin tests live in `tests/plugin/`, collected by the root unit config. Keep tests and fixtures
outside both `plugins/garden-claude/` and `plugins/garden-codex/`: each package is copied whole
into the user's plugin cache. These tests run real subprocesses against isolated temporary
files. Claude's shell hooks and pipeline scripts require `bash`, `jq` and, for pipeline state,
`git`; Codex's compaction hook uses Node 22. Neither needs a tmux server, so they run in the
unit tier. “`execFile` is never mocked” governs how a subprocess is exercised, not which tier
gets to exercise it.

Use `claude-*` and `codex-*` filenames for harness-specific plugin suites and support modules;
keep unqualified names for genuinely shared checks such as `plugin-packaging.test.ts`.
Compaction suites share that term: Claude splits warning, recovery and usage-filter checks;
Codex exercises its combined hook. Suite labels and temporary-directory prefixes identify the
harness too. `support/claude-plugin.ts` supplies only Claude fixtures, including its transcript
format; Codex fixtures stay with their own suite. Shared temporary-directory creation and
cleanup live in `support/temp-directories.ts`.

Run `pnpm exec vitest run tests/plugin` for both packages. Script tests establish behavior for
supplied hook payloads and fixture transcripts; packaging tests check installed paths and
reviewer references within each independently installed package. Neither proves native plugin discovery, hook scheduling, warning
feedback delivery, compaction timing or model compliance with skills. Those need an explicitly
recorded live check with the relevant harness version. The fake-harness integrations below
exercise Garden's lifecycle wiring, not native plugin loading.

Each package's `vitest.config.ts` collects only its own `src/**/*.test.ts`, and the root config
only `scripts/**/*.test.ts` plus repo-level `tests/**/*.test.ts` except `tests/integration/**`, so
a test under `tests/integration/` can never be collected by `pnpm test`. Every config runs
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
- **`adapters/`** tests pure protocol parsers and command builders with ordinary unit tests.
  Its I/O uses the integration tier: tmux driven on an isolated socket, git driven in a
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
wrong. Session transitions do not need a live model: `scripts/fake-claude.ts` and
`scripts/fake-codex.ts` replace its judgment with deterministic input handling while retaining
a real process in a real tmux pane, real hook delivery and real transcript files. Use the fake
matching the instance's harness; their payloads, transcript formats and launch protocols differ.
The integration suites `tests/integration/fake-claude.test.ts` and `fake-codex.test.ts` exercise
those boundaries. They do not establish how an installed Claude or Codex version behaves.

- **`execFile` is never mocked, anywhere.** Faking a port substitutes one implementation of a
  declared interface; mocking `execFile` pretends the process boundary behaved. The test then
  passes because the mock returned what you told it to, while the argument array — the thing
  that decides whether `new-session` got the right `-c`, `-e`, and name — goes untested. To
  test argument-building logic, extract argument building into a pure helper beside its adapter and
  test that; let the line that calls `execFile` be proven by an integration test.
- **tmux** has exactly one legitimate fake: the `TmuxPort` interface, faked at the `app/` tier
  to test orchestration without spawning anything. Adapter tests always drive the real binary
  on an isolated socket. `domain/` needs no tmux fake — tmux facts are plain data by the time
  derivation sees them.
- **Transcripts** use real files in a temp directory throughout: the parser, the reconciliation
  scan, and the live poll all do plain fs reads. The poll tests fake only `setInterval`,
  `clearInterval` and the clock, so the ticks are driven by hand while the reads still complete on
  the real event loop. The fake-Claude and fake-Codex integration suites drive real
  transcript files through their respective lifecycle and hook paths.
- **Hook payloads** are the cheap case: plain JSON over HTTP. Use a builder, not a fake.
- If a unit test reaches for `vi.mock`, treat it as a signal rather than a tool — either the
  code under test imported an adapter it should not have, or the test belongs in the other
  tier. Passing a hand-written fake into a use case is not mocking; that is the port working.

## Running a sandbox

`pnpm dev:sandbox:server` boots an isolated garden: its own port, tmux socket and app dir, with
`scripts/fake-claude.ts` in place of Claude. This convenience command configures the Claude
fake only; for a Codex instance, use the isolated setup in `tests/integration/fake-codex.test.ts`
as the reference for its command, home and harness environment. An isolated sandbox runs beside
the user's real `garden` without either seeing the other's sessions, which makes it safe for an agent
to start one for a manual or visual check. Never start, stop, signal or reconfigure the real instance (the
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

**The fake-harness compositions.** Both `tests/integration/fake-claude.test.ts` and
`fake-codex.test.ts` combine a long-lived fake process in a real pane, a live HTTP server and
real transcript files. Claude's suite assembles the server and watcher; Codex's suite starts
the actual server entrypoint and exercises generated hooks, binding and restart recovery.
Each fake prints a `READY` marker when its stdin loop is attached. Poll for it before sending
input: `tmux send-keys` can succeed before the process is ready and lose the input without an
error. Keep the process, server and files isolated and tear them down with the socket.

## Flake policy

**Poll with a deadline; never sleep.** State transitions in tmux are not synchronous with the
command that caused them — a pane reports dead some time after its process exits. A fixed
sleep is either too short (flaky) or too long (slow), and it encodes a guess about someone
else's timing. Poll the condition until a deadline and fail with what the last observation
actually was, so a timeout tells you what state it was stuck in.

The same rule applies to the transcript poll: assert that a change was picked up by waiting for it,
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
