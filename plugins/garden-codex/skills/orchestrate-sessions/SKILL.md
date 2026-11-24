---
name: orchestrate-sessions
description: >-
  Run and oversee Codex sessions through garden's CLI — create a session
  in a directory, dispatch work to it, read its status, wind it down, and keep
  several running at once. Use for "create a garden session", "start a session
  in this repo", "list garden sessions", "what sessions are running", "kill a
  session", "resume a session", the bare CLI verbs (`garden new`, `garden ls`,
  `garden kill`, `garden resume`), and for anything spanning several sessions:
  "spin up sessions for these three issues", "check on the sessions I started",
  "is that one done yet", "wind these down", or coordinating a stacked PR
  review. Use it to wait on peers, size reports, or interpret session status. Not for the garden server itself — "stop the server", "shut garden
  down", "restart the server", "uninstall garden" (`garden stop`, `garden uninstall`) name the server process, not a
  session. Composing and addressing a note to one named session belongs to
  `message-session`; waiting on a PR belongs to `watch-pr`.
---

# Orchestrating Codex garden sessions

Garden runs each Codex session as a tmux session behind a local server. The Garden CLI is the
control surface. The commands below cover session lifecycle. `message-session` covers peer
messaging and `watch-pr` covers PR-watch flags. Use the native collaboration tools exposed in your current conversation to dispatch and await
native subagents for work you need to collect inside that conversation.

A Garden session is an independent peer with its own context window, permission boundary and
user channel. Its reports arrive by message, and its transcript stays in its own pane. Garden
reads the launch permission policy from the instance's `<appDir>/config.json` at server start.
`GARDEN_APP_DIR` overrides the Codex default `~/.garden-codex`. With `permissionMode: default`,
Garden leaves approvals and sandboxing to the peer's Codex settings. An instance already
configured to bypass permissions passes its bypass setting at launch. The peer uses local
Codex model and effort defaults unless you pass `--model` or `--effort` to `garden new`.

The second thing: **your context only grows.** Every brief you send and every report you receive
is re-read on each later turn for the rest of the run, and nothing already in the window gets
smaller. A peer's long report costs that peer once and costs you on every turn that follows. That
asymmetry is the reason behind most of what is below — detail belongs in the peers, the files and
the PRs, not in your window.

## Dispatch

`garden new <dir> --json` places the new peer under you as it spawns: the CLI reads your own
`GARDEN_SESSION_ID` and hands it to the server as the caller, which records the child's `parent`
as you — minting you a swarm on the first dispatch if you're top-level — so the
relationship lands in Garden's own swarm data with no second call. Keep the returned `id` as
the peer's message address. A new Codex session can accept its first brief before the thread
binds. Once the peer appears in `garden ls --json`, confirm its `parent` matches your
`GARDEN_SESSION_ID`. If the row is missing just after launch, allow startup before diagnosing
the placement.

Leave `--model` and `--effort` off by default: which model and how much effort a piece of work
deserves is the user's cost-versus-quality call, and a bare `garden new` gives the peer what a
`codex` the user started themselves would get. Set them when the user named a model or effort for
the work, or the brief you are relaying pins one — and pass them again on `garden resume`, because
garden doesn't store them and a bare resume sends none.

Before the first spawn, check for the inherited `GARDEN_HARNESS=codex` and `GARDEN_SESSION_ID`.
Preserve the inherited port, app directory and tmux socket so commands reach the same
instance. From an outside shell, select the Codex instance explicitly with `garden --codex …`
and use the intended instance's settings. An older Garden launch or an outside session may
have no `GARDEN_SESSION_ID`. `garden new` still exits 0
and returns a normal `{id, tmuxName}` in that case, but records no parent: the peer lands in Solo,
untracked, and `garden adopt` on it exits 1 (`GARDEN_SESSION_ID is not set`), since that verb
reads the same variable from the caller. If it's unset, say so before dispatching rather than
spawning peers you can't later adopt — the user can group them by hand in the web console, or you
can be restarted from garden so a fresh session picks the variable up.

Reach for `garden adopt <id> --json` instead when the session already exists and wasn't spawned
under you — one a teammate started, or one that predates your own `GARDEN_SESSION_ID` — to place
it under you after the fact. Look up and retain its Garden `id` from `garden ls --json` before
adopting it into the run. Brief the peer like a fresh spawn and use that UUID for its
`<session-id>.md` file.

**Decide where new work goes when you assign it.** Give concurrent writers their own worktrees
and explicit ownership. Reuse a session when the next task shares its
files and decisions and its current work has reached a stopping point; it
already holds the context a fresh peer would have to rebuild. Start a fresh one when the task needs
its own plan, or when it would leave the session running two pipelines at once, because two
pipelines in one session collide. A peer whose PR is ready but waiting on the user's merge decision is still mid-pipeline, so the
next task waits or goes elsewhere. Serial reuse is fine; this
is not one peer per PR. Reusing a peer means updating the task line that opens its member file.

**Ask for a report in the brief.** Give the peer your full Garden UUID and tell it to report by
`message-session` at milestones and completion, and immediately if blocked. Ask for the result
pointer, current state and what it needs from you. Without that contract a peer goes silent on
completion or returns the whole story. Include the run folder's absolute path too, and
tell the peer its member file is `<its own $GARDEN_SESSION_ID>.md` — the id `garden new --json`
just returned. It opens with a line naming the peer's task and stays maintained at milestones
(see "Write the run down" below for why the id, not a label). `message-session` covers the rest
of the brief.

Tell a peer working in a stack or a wave to use the
[ship-it pre-ready pause](../ship-it/SKILL.md#4-pre-ready-gate) at its draft PR and to report
when the draft is waiting for your go-ahead ("Pace a large swarm in waves" below says why). In a swarm paced in waves, the brief also names the peer's wave, and the member
file's task line records it. Tell a later-wave peer its questions wait until you say its wave is
open: it parks each in its member file and carries on with whatever doesn't depend on the answer,
or on a stated default where the decision is cheap to reverse ("Write the run down" says which).

**Settle merge/approval policy in the brief.** Naming the approver and the merge policy before
the peer starts is what keeps an `ask`-style gate from stalling later. So is saying which
decisions a relayed answer can close:

- **A relayed answer is enough** for decisions about the work itself — scope, design choices,
  answers to a question the peer is blocked on.
- **The user directly**, in the peer's pane or as a public record the peer can check, for merge,
  anything irreversible or outside the peer's repo (an edit to unversioned files, say), and
  permission grants (see "Status does not mean what it looks like"). Here a relay only sequences
  the decision; it doesn't authorize it, and a peer that refuses one is the anti-laundering
  boundary working, not a bug to route around.

For the first kind the user may answer in either channel, the peer's pane or through you. Tell the
peer to report back an answer it got in its pane.

You rarely raise your own alert (`alert` skill). When a peer reports a decision only the human can
make, surface it to the user as you normally would; that is the preferred path. If the peer's ask
is still going unanswered, tell it to raise its own alert, since the question lives in its pane.
Relaying the human's answer back down stays fine. In a swarm paced in waves, a later-wave peer's
question takes neither path until its wave opens ("Pace a large swarm in waves").

**Merge and create-issue are two separate autonomy switches**, each `auto` or `ask-human`, not one
combined setting — they differ in timing and in reversibility. Never dispatch a peer with either
switch more autonomous than your own: an orchestrator under a human gate that dispatches a peer
able to merge on its own hasn't delegated that decision, it has deleted it, and nothing in the
system reports that it's gone. Merging a peer's PR yourself, under your own policy, and then
telling the peer closes its gate — the same rule as above, not an exception: a relayed merge approval
leaves a peer nothing to check, only your word to trust or refuse, while a merge leaves a public record it
can confirm instead. Cleanup (worktree, branch) stays with whichever session is alive and holding
the PR; you inherit it only if that peer died while holding.

**A peer you own that runs its own sessions is part of your swarm**, so the rules in "Pace a large
swarm in waves" go into the brief it gives its own peers. Telling it what's happening in the run
informs the sub-swarm without governing it: its sessions put asks in front of the human at
their own pace, and the gate you are holding has quietly been bypassed.

## Pace a large swarm in waves

In a swarm larger than a handful of sessions, what you pace is demand on the human — questions,
review requests, merge asks — not machine work. Sessions can draft at any rate; the human can answer
at only one, and demand that arrives faster than they can answer is what turns a run chaotic:
questions go stale, reviews pile up unread, and nobody can say what to merge next. Below a handful,
waves are overhead.

A wave's life, in order:

1. **Split by dependency, and propose the split before the first `garden new`.** What blocks what
   decides the waves. For example: a small enabling fix every branch needs, such as a CI repair, as
   a wave of its own; then foundations (libraries with no deployed surface); then the first
   deployed behaviour; then runtime and UI. That is one swarm's shape, not a template — yours may
   not have those layers. Put the split to your user before dispatching. They tune the gating —
   what blocks what, how much goes in a wave; you own the mechanics — membership, when a wave
   opens, bringing PRs up to date, loop release.
2. **Drafting is never gated; asks are.** Any wave's sessions may be dispatched and draft. Only an
   open wave's questions, review requests and merge asks reach the human, so everything they see is
   something they can act on now. A later-wave peer parks its questions in its member file
   ("Dispatch"), and they reach the human as one batch when its wave opens. Permission prompts are
   not held: one is a ten-second answer, the console shows `needs-approval` whatever you hold back,
   and a peer stalled on a prompt before its draft exists is drafting being gated.
3. **Each session pauses at its draft PR.** It runs ship-it through internal review, with its review
   loop named as usual, and stops before that loop starts to wait for your go-ahead. Everything
   past that point spends review rounds before anyone knows the wave fits together.
4. **Verify the wave.** Verified means sandbox-tested end to end — or, for library-only PRs, one
   integration branch carrying all of them that builds and tests green — with no further changes
   expected. Until then a downstream finding can still change an upstream PR. Verification spends
   scarce things besides the human's answers:
   - **The environment.** Before verifying, find what else writes to it — a main-branch pipeline,
     another session, another wave — and settle with your user how to keep it stable for the
     length of the run, since a write mid-run invalidates the result without saying so. Run one
     integration build at a time, with one session owning the slot: two builds sharing an
     environment test neither.
   - **Manual steps only the human can do**, such as a login valid for an hour, are demand like a
     question. Peers don't ask for them; each tells you what it is ready to run and how long it
     takes, and you batch those into one ask per window, so one login covers every run that needs
     it.
5. **Release review-bot loops last, per PR, one or two at a time.** A PR's loop starts once its
   wave is verified, every PR it depends on has merged, and it has been brought up to date with the
   main branch. A loop that finishes before verification is redone when testing forces a change,
   and one that runs before its dependencies merge is redone when their review changes ripple into
   it. Ripple runs along dependencies, not waves, so the gate does too: a PR whose dependencies
   have merged doesn't wait on unrelated PRs, and the upper PR of a stack inside one wave waits for
   the lower one. One or two at a time keeps review traffic at the rate the human can read it.
   Which PR to bring up to date when is in "Trust the peer's pipeline". Ask each peer to report
   a finished or blocked loop so you can release the next eligible PR immediately. With
   `Review loop: none`, the same go-ahead clears the draft pause without using a slot.
   Follow repo bot policy and any explicit user override to the review timing, such as an
   early stack review. Merge still follows its own approval policy.
6. **Hand PRs to the human as they become ready**, in the one merge-ordered list "Keep the traffic
   small" describes. With loops released per PR, PRs go ready one at a time, and a list kept current
   lets the human merge continuously instead of waiting for a whole wave.
7. **Open the next wave once this one's must-merge-first PRs have merged** — the hard blockers the
   next wave builds on, not every PR in it. Waiting on every merge idles the swarm on PRs nothing
   depends on. **At most two waves are open**: N waiting on the human's merges, N+1 in progress. A
   wave closes when every PR in it has merged, and only then may the wave after N+1 open. Two is the
   most demand the human can track at once: N+1's questions and reviews keep the swarm busy while
   they work through N's merges. A third open wave interleaves a third queue of asks with those two,
   and that is where they lose track of which ask belongs to what.

Pausing at the draft, verifying, and releasing loops along dependencies apply to any stack of PRs,
whatever the swarm size; only splitting into waves waits for a large swarm.

## Session identity and display names

Use the full Garden `id` from `garden new --json` or `garden ls --json` for run membership and
messaging. `GARDEN_SESSION_ID` is that Garden UUID. A Codex thread has a separate native id.
Garden addresses the current thread by the stable Garden UUID through `message-session`, including
after a conversation reset or a kill and resume. For a one-off `garden resume`, `garden kill`,
or `garden adopt`, the CLI can also resolve a unique exact `sessionName`. Use the UUID for a
tracked peer or when ending a peer as part of the run.

The web console shows a display title and uses `sessionName` in the pane's session metadata.
Use the visible session name with the task in user reports so the user can find the pane.
Fall back to the display title and task if the session has no name. A title can change or be shared by several sessions. Use
`garden ls --json` when you need to confirm which Garden UUID owns the work. The separate
`tmuxName` identifies the terminal pane.

Your user reads reports across many sessions and PRs, so name each session with what it works on —
"session `garden-d0` for PR #245", not "the session for #245" — and say whether a number is a PR or
an issue, since the two share one sequence. Once the run spans more than one repo, write `<repo>#N`
(`garden#245`): a bare number could belong to either. That is the user-facing form; notes between
sessions keep `message-session`'s `owner/repo#N`.

## Write the run down

Context windows are the one place run state does not survive: yours fills up, a peer exits,
and working details fall out of context or are lost when a run moves to a new conversation. So keep it on disk — a run folder,
`.orchestration/<run>/` in the repo you are orchestrating from. Add it to `.git/info/exclude` with
a trailing slash so the whole tree is excluded, where the repo doesn't already ignore it. Give
peers the folder's **absolute** path in the brief: the same relative path in a peer's worktree is
missing or a different run's folder.

Every file in the folder has exactly one writer, and anyone in the run may read anything in it —
that one-writer rule is what makes free reading safe with no locking, since no two sessions ever
race to update the same bytes.

`run.md` is yours alone. It holds only what no other system holds — a policy header and two
sections:

```markdown
# settings-ui — started 2026-09-21

merge: ask-human (approver: <name>) · create-issue: auto · swarm: 6f1c9e2a-3b7d-4c58-9a0e-2d4f8b1c7e35

## Blocked

- session `garden-c1` for issue #160 — waiting on user: which launch commands to list (asked, unanswered)
- session `garden-e2` for issue #159 — user answered "SSM, not env"; peer not yet told
- wave 2 (issues #161, #162) — opens when PR #170 merges

## Decisions

- user: settings read path is client-only, no server proxy
- user: proxy through the server after all (supersedes client-only — CORS blocked the direct read)
- default, awaiting user: settings cache TTL 60s (cheap to change; PR #171 records it)
```

`swarm` is your own `swarmId` from `garden ls`, and only a top-level session has one: if you are
top-level, dispatching your first peer mints you one (see "Dispatch" above), so it's there to record
by the time you write the header. A child shows `parent` set and no `swarmId`, which is the normal shape, not a
failed attach. Find its swarm by following `parent` up, or with `garden ls --json --swarm <id>`.

Blocked records the event that unblocks, not a status — "waiting on your user", "answered but
the peer hasn't been told" and "peer has it and is working" look alike in a status field and need
three different things from you — and the entry goes when the event fires. A wave not yet
open is a Blocked entry like any other, its event the merge of all its blockers.

When a blocker merges, release the work it was blocking right away, even while your user is away:
tell the peers still drafting on it, in whatever wave, so they keep drafting on what landed. A peer
already paused at its draft PR is in the merge queue, so it is brought up to date only when its
loop or merge comes up next ("Trust the peer's pipeline" says why). That is machine work, so it
needs no one's say-so and keeps the swarm moving. Releasing work is not opening a wave. The wave
opens only when its last blocker has merged and the two-wave limit allows, because opening it puts
its asks in front of your user.

A decision that comes up while your user is away, or for a wave not yet open, is sorted by what it
costs to reverse, and that call is yours. One that is cheap to reverse proceeds on a stated
default: the peer records the choice and its cost in its PR, you log it under Decisions as awaiting
confirmation, and your user later gets it as "confirm or overrule". They still make the decision,
with the work already done on the likelier branch. One that is costly to reverse — a contract,
anything deployed or outward-facing — goes under Blocked as waiting on your user, because
proceeding would make the decision for them.

Decisions are appended with who made them and on what, never edited: a reversed decision and the
reason it was reversed are both things nothing else on disk holds.

Everything else has an authoritative home: `garden ls` owns cwd, branch, liveness and status; git
owns commits and worktrees; GitHub owns PR, CI and review state. A copy here can only go wrong —
a green CI line is about a commit, not a time, so it is stale the moment a peer pushes however
recently you wrote it. Point at plans, PRs and commits, and when the file disagrees with those
sources, they win. `run.md` is authoritative only for intent and decisions.

Write to it on a block or unblock, or a decision, and not otherwise: that keeps it
small enough that updating it never becomes a task of its own, and means a change to it says
something. It follows that the file is only as current as your last write — a head start for a
session picking the run up, not live status.

`<session-id>.md` belongs to one member and no one else writes it, named for the member's own
`$GARDEN_SESSION_ID`. Garden assigns the UUID at creation and retains it as the peer's native
Codex thread changes. Use it for the same member file after a kill and resume or a conversation
reset. You already have it — from
`garden new --json`'s `id` field or `garden ls --json` before adoption — so there's
nothing to assign or check for collisions. Open the file with a line naming the member's task, so
a folder of ids stays readable. It's a short snapshot of that member's goal, decisions, state, and
next step — updated at milestones (assignment accepted, a material decision, a blocker,
completion), not every turn.

After compaction or when taking over a run, reread `run.md` and every member's file before
acting. Recheck outstanding blockers against their owning sources. If an authorized peer
stopped before reporting and its work still needs doing, use `garden resume <id> --json` and
brief it from the existing run and member files. It should check the current PR and worktree
state before continuing.

## Keep the traffic small

`message-session` owns address resolution and note sizing. Load it before your first message of
the run, and **put it in every brief**: tell the peer to load it before it reports back, because a
peer's five-page report costs you what your five-page brief cost it, and a peer that never read
the skill has no reason to know that.

Reports up to your user follow the same shape for a different reason: they can open any peer's
pane themselves, and they will ask when they want more. So carry the major issues and decisions —
blocked, merged, needs you — and leave the rest. Re-narrating a peer's report pays for that report
a second time and tells your user something they could already see.

In a swarm paced in waves ("Pace a large swarm in waves"), demand reaches your user in two
shapes. When a wave opens, the questions its peers parked go as one message, numbered — one
context switch rather than one per peer. After that, PRs reach them through one list in merge
order, kept current and restated whenever it changes: each PR with what it waits on, then a
separate list of what only they can do — merges, manual steps, defaults to confirm, decisions left
to them — with questions numbered. One list means the latest message is always the whole picture,
merge order is the order they will act in, and numbered questions come back answered by number
instead of ambiguously.

## Trust the peer's pipeline

A peer running its own pipeline has already had a review stage, and output it pasted from a
command in the same checkout you would verify from is evidence: re-running its greps re-proves
what it proved, and lands the output in your window twice. Verify before a merge or a deletion, on
a major decision, when your user asks, or when that peer has been wrong more than once — and
dispatch a subagent so the evidence doesn't land in your window. A
recommendation out of proportion to the finding behind it is a decision, not a report: put it to
your user.

You are not the reviewer. Don't add code-shape requirements to a "go" or reopen a pipeline past
its stop condition; review from here only for a reason you can state, and keep it targeted. The
gate you hold is merge.

The exception is a follow-up edit you relay on an existing PR, which does reopen the pipeline, so
say whether it is small or large. **Small** means the outcome is settled, the code location is
known, and it changes no contract, security boundary or data invariant: the peer makes it with no
review round, because reviewing a decided, located change can only re-litigate the decision. Line
count isn't the test. The label is your read without the code, so a peer that finds the edit does
touch a contract or invariant says so and runs rounds; the peer's judgment stays the control here.
**Large** edits run the normal pipeline rounds. When several PRs update together, such as syncing a
stack, tell each peer to batch: say when the batch ends and review the final heads once, since each
intermediate head is superseded before anyone merges it. In a queue of PRs waiting to merge, bring
up to date only the one that merges, or has its loop released, next: every merge moves the base
again, so updating the whole queue after each one redoes the same work once per merge ahead of it.

## Wait on reports and PR events

The report contract is how you wait on a peer. It messages you at a milestone, at completion
or when blocked. Garden routes the note to your Codex thread. The send acknowledgment
confirms acceptance by the transport. Use the peer's reply or independently verified evidence
to establish what happened.

Use `watch-pr` for PR events you need to act on, such as an upstream merge or a check the parent
needs for integration. Confirm the session's forwarder is connected and the relevant watch is active
before relying on it. When a report, decision or digest unblocks work, reconcile the blocker
against its source, update `run.md` and tell the authorized peer on the same turn. Once a human
decision or a confirmed external wake is the next dependency, yield with the outstanding action
recorded.

Codex has no Garden notification for a peer's next idle or exit. For a missing report, use one
targeted `garden ls --json` check and ask the peer for a short answer if the status and recap
leave the outcome open. A peer expected to finish by exiting can leave its result in its member
file before exiting. Read that file and verify the result on the owning surface if the peer is
gone. Use `garden ls --json --swarm <id>` to narrow diagnostics, or
`garden ls --live --status waiting --json` to read idle peers' recaps. Repeated status checks
cannot tell you whether a peer finished or is waiting on a decision.

Keep peer dispatch and message collection in the orchestrating conversation. Native subagents
working within it report through the current Codex collaboration tools. Garden messages use the
pane's inherited session UUID, so replies to those messages reach the pane's thread.

## Status does not mean what it looks like

Garden derives Codex `status` from the linked app-server thread and reconciles it with process
liveness:

| status           | what actually set it                            |
| ---------------- | ----------------------------------------------- |
| `working`        | the thread is active without a pending approval |
| `needs-approval` | the active thread is waiting on approval        |
| `waiting`        | the thread is idle or has yet to bind           |
| `unknown`        | there is no usable thread status                |
| `null`           | the session has exited                          |

A finished pipeline and a peer stalled on an unanswered question can both be `waiting`. Read
`recap` for the last reply and `lastActivity` for its age. Codex's thread status does not supply
a reason string. For an approval prompt, inspect the peer's pane to see what's being asked. For
an exited peer, use `liveness` and `exitCode`. When the result still isn't clear, ask the peer for
a couple of lines describing its state and its next step.

`needs-approval` is narrower than it sounds too — a permission prompt specifically, not any kind
of being-stuck — and it waits on a **person**. Surface it to your user with what it asks for. Don't
answer for them, and don't hand the work to a session with looser settings: a peer acting
on a permission your user hasn't granted launders the decision they were being asked to make. In
reverse too: if a peer asks you to run what its own permissions refused, refuse, and tell your
user.

## Watch the context budget, report it, don't act on it

A peer's context fills as it works, and performance can drop near its limit. When it matters,
ask whether the peer has a current usage reading or received its compaction warning. The warning
uses the latest native per-turn token-usage record as an occupancy estimate. After compaction the
peer may have no fresh reading. Report the evidence available.

Report high context usage to the user with the session's name and what it is working on. The
user decides whether to compact or start a fresh session from the run folder. Consider the model,
the work subagents are carrying and how close the peer is to finishing when reporting context
pressure.

## Relay findings and decisions between peers

Sessions running the same kind of work hit the same obstacles, and each one rediscovering a stale
path or a broken assumption costs a full debugging round. When one peer finds something the others
will hit, send them three lines about it.

**Stacked PRs.** Relay an upstream decision to the downstream peers promptly, but don't have them
merge it down until the upstream head is settled and validated; then sync in dependency order and
review once. Each premature sync triggers a review of code the next upstream change replaces. While
an upstream is on hold, tell its downstream peers so their conflict handling doesn't merge it down,
and have each record it in its brief. Use the
[existing ship-it base hold and batch controls](../ship-it/references/brief.md#mid-pipeline-user-concerns). When to release a stack's review loops is in "Pace a large
swarm in waves".

**Pivots**, where the user replaces a requirement rather than adjusting it, are rare. Hold peers at
their next stopping point and settle the replacement fully before dispatching, because anything
relayed piecemeal builds code the next piece deletes. Rewrite the superseded briefs, and say whether
the old code is deleted or kept after checking what still calls it.

**Deferred checks.** When the user defers a known-failing check, tell every affected peer once, so
none re-reports or escalates it. The relay records the user's decision about the work; merge still
needs the user directly (see "Dispatch"). Use `watch-pr` to apply
`garden watch <pr> --ignore-check <name>` to the owning watch.

## Winding down

A session is resumable, but killing one early costs a `garden resume` and the turn it was in.
Its Garden UUID persists. End it after the peer reports completion and you decide against
reusing it, or when the user asks you to end it. If the expected report is missing and status
is ambiguous, read its recap or ask before deciding.

Kill by full Garden id and verify the id is one of your children:

```sh
garden ls --json | jq -r --arg me "$GARDEN_SESSION_ID" '.[] | select(.parent==$me) | .id'
```

If the id is outside that list, ask the user. Check the UUID, ownership and worktree before
ending the peer. A reused visible name can point to another session.

Winding down a peer leaves the run folder in place: other members still need their files, and a
peer mid-write to its own has no way to know it just disappeared. Remove `.orchestration/<run>/`
only once every member is wound down and you are ending your own run too — with the whole swarm
gone, nothing left will read the folder or clean it up.
