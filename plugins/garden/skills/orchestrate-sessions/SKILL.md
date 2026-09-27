---
name: orchestrate-sessions
description: >-
  Run and oversee Claude Code sessions through garden's CLI — create a session
  in a directory, dispatch work to it, read its status, wind it down, and keep
  several running at once. Use for "create a garden session", "start a session
  in this repo", "list garden sessions", "what sessions are running", "kill a
  session", "resume a session", the bare CLI verbs (`garden new`, `garden ls`,
  `garden kill`, `garden resume`), and for anything spanning several sessions:
  "spin up sessions for these three issues", "check on the sessions I started",
  "is that one done yet", "wind these down". Reach for it before improvising a
  wait, sizing a message or a status report, or reading a session's status as
  done. Not for the garden server itself — "stop the server", "shut garden
  down", "restart the server", "uninstall garden" (`garden stop`, `garden uninstall`) name the server process, not a
  session. Composing and addressing a note to one named session belongs to
  `message-session`.
---

# Orchestrating garden sessions

garden runs each Claude Code session as a tmux session behind a local server, and its CLI is the
control surface. `references/cli.md` carries the mechanics — subcommands, flags, output shapes,
exit codes, the `SessionState` fields, the `ls` filters — and this file is about using them
together.

The one thing to hold onto: **a garden session is a peer, not a subagent.** It has its own
context window, its own permission boundary, and its own user. You cannot await it, you do not
see its transcript by default, and it inherits nothing from you — not your permission mode, not
your model, both of which are whatever the local `claude` would use alone.

The second thing: **your context only grows.** Every brief you send and every report you receive
is re-read on each later turn for the rest of the run, and nothing already in the window gets
smaller. A peer's long report costs that peer once and costs you on every turn that follows. That
asymmetry is the reason behind most of what is below — detail belongs in the peers, the files and
the PRs, not in your window.

## Dispatch

`garden new <dir> --json` places the new peer under you as it spawns: the CLI reads your own
`GARDEN_SESSION_ID` and hands it to the server as the caller, which records the child's `parent`
as you — minting you a swarm on the first dispatch if you don't already have one — so the
relationship lands in garden's own swarm data with no second call. Neither `id` nor `tmuxName` is
the address you send messages to — see "Two naming systems" below. The id exists before the peer
does, so a resolve that misses right after `new` means not-yet-started: retry before concluding
anything.

Check `GARDEN_SESSION_ID` is set in your own environment before that first spawn — a session
started by an older garden, or never started by garden at all, has it unset. `garden new` still exits 0
and returns a normal `{id, tmuxName}` in that case, but records no parent: the peer lands in Solo,
untracked, and `garden adopt`/`garden handoff --to` on it exit 1 (`GARDEN_SESSION_ID is not set`),
since those verbs read the same variable from the caller. If it's unset, say so before dispatching
rather than spawning peers you can't later adopt or hand off — the user can group them by hand in
the web console, or you can be restarted from garden so a fresh session picks the variable up.

Reach for `garden adopt <id> --json` instead when the session already exists and wasn't spawned
under you — one a teammate started, or one that predates your own `GARDEN_SESSION_ID` — to place
it under you after the fact. Brief it the same way you would a fresh spawn (run folder path,
report contract) — its member file is already named by the `<id>` you just adopted it with, and
adoption changes who placed the session, not what it owes the run.

**Don't add `--handoff` to the command above expecting an enhanced spawn.** It reads like a flag
on the same call, but it does the opposite of ordinary dispatch: instead of placing the new peer
under you, it moves _your own_ `parent`/`swarmId`/children onto the new session and leaves you a
leaf with `successor` set — the exit code and `{id, tmuxName}` shape are identical either way, so
nothing at the call site catches the mix-up. That's the self-succession move covered under
"Winding down" below; reach for it only to end your own run, never to spawn an ordinary peer.

Give a peer somewhere of its own to work: a worktree per task, not a shared checkout. Two sessions
in one working directory fight over the index and the branch, and neither will report that as the
cause of whatever breaks.

**Ask for a report in the brief.** Tell the peer to message `<your session name>` when it
finishes, and immediately if blocked, with a pointer to the result, its state, and what it needs
from you. Spell your own name out; the peer cannot derive it. Without that contract a peer goes
silent on completion or returns the whole story. Include the run folder's absolute path too, and
tell the peer its member file is `<its own $GARDEN_SESSION_ID>.md` — the id `garden new --json`
just returned (see "Write the run down" below for why) — opened with a line naming its task, and
maintained at milestones. `message-session` covers the rest of the brief.

**Settle merge/approval policy in the brief.** Naming the approver and the merge policy before
the peer starts is what keeps an `ask`-style gate from stalling later. Relaying an
approval only sequences the decision; it doesn't authorize it, because the gate isn't yours to
close by relay. A peer that refuses a relayed approval is the anti-laundering boundary working as
intended, not a bug to route around.

**Merge and create-issue are two separate autonomy switches**, each `auto` or `ask-human`, not one
combined setting — they differ in timing and in reversibility. Never dispatch a peer with either
switch more autonomous than your own: an orchestrator under a human gate that dispatches a peer
able to merge on its own hasn't delegated that decision, it has deleted it, and nothing in the
system reports that it's gone. Merging a peer's PR yourself, under your own policy, and then
telling the peer closes its gate — the same rule as above, not an exception: an approval leaves a
peer nothing to check, only your word to trust or refuse, while a merge leaves a public record it
can confirm instead. Cleanup (worktree, branch) stays with whichever session is alive and holding
the PR; you inherit it only if that peer died while holding.

## Two naming systems

A session has a garden/tmux name (`79-bounded-session-list`) and a Claude Code name that
addresses it for messaging (`79-bounded-session-list-c0`). The suffix is a random disambiguator,
not a hash or slice of anything you hold, and the session id is the only bridge between them. So
resolve the address with `message-session`'s `resolve_session.sh`, every time. The messaging name
belongs to one process: resume or restart a
session and it comes back under a different one, so a name quoted from memory is stale the moment
its process is — and a misdelivered note fails silently in both directions.

`GARDEN_SESSION_ID` is garden's own identifier, not Claude Code's: the registry session id
`message-session`'s `resolve_session.sh` reads from `~/.claude/sessions/<pid>.json` is a separate
value. An in-pane `/clear` is believed (but unverified) to mint Claude Code a new registry session
id without changing garden's `GARDEN_SESSION_ID` — identify a session by the garden id, which
survives that.

When you report to your user, use the Claude Code name — that's what renders in the web console's
pane header, not the garden/tmux name. The web console never shows the id itself; for that, use
`garden ls` or `message-session`'s `resolve_session.sh`. The tmux name still answers a different
question: which pane to attach a terminal to, and — since `ListAgents` prints it beside each
session — which row is yours when two live sessions share a messaging name.

`status` is also two words: the script prints Claude Code's registry status (`idle`, `busy`,
`shell`), garden's column is derived from hooks (the table below). Different sources, different
questions.

## Write the run down

Context windows are the one place run state does not survive: yours fills up, a peer dies, an
address changes on resume, and what you knew goes with it. So keep it on disk — a run folder,
`.orchestration/<run>/` in the repo you are orchestrating from, added to `.git/info/exclude` with
a trailing slash to exclude the whole tree (the same shape as this repo's own top-level
`.gitignore` entry for the directory) where the repo doesn't already ignore it. Give peers the
folder's **absolute** path in the brief: the same relative path in a peer's worktree is missing or
a different run's folder.

Every file in the folder has exactly one writer, and anyone in the run may read anything in it —
that's what makes free reading safe with no locking: nobody edits a file they don't own, so two
sessions never race to update the same bytes.

`run.md` is yours alone. It holds only what no other system holds — a policy header and two
sections:

```markdown
# settings-ui — started 2026-09-21

merge: ask-human (approver: <name>) · create-issue: auto · swarm: 6f1c9e2a-3b7d-4c58-9a0e-2d4f8b1c7e35

## Blocked

- #160 — waiting on user: which launch commands to list (asked, unanswered)
- #159 — user answered "SSM, not env"; peer not yet told

## Decisions

- user: settings read path is client-only, no server proxy
- user: proxy through the server after all (supersedes client-only — CORS blocked the direct read)
```

`swarm` is your own `swarmId` from `garden ls` — dispatching your first peer mints you one
automatically (see "Dispatch" above), so it's there to record by the time you write the header.

Blocked records the event that unblocks, not a status — "waiting on your user", "answered but
the peer hasn't been told" and "peer has it and is working" look alike in a status field and need
three different things from you — and the entry goes when the event fires. Decisions are appended
with who made them and on what, never edited: a reversed decision and the reason it was reversed
are both things nothing else on disk holds.

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
`$GARDEN_SESSION_ID` rather than anything you assign. garden mints one UUID at creation for both
Claude's `--session-id` and `GARDEN_SESSION_ID`, and `resumeSession` relaunches a killed session
with `--resume <that id>` — so the id outlives a kill-then-resume and the `/clear`-driven identity
change "Two naming systems" above describes, where the tmux name and the messaging name do not.
You already have it — from `garden new --json`'s `id` field, `garden ls`, or the id you passed to
`garden adopt` — so there's nothing to assign or check for collisions. Open the file with a line
naming the member's task, so a folder of ids stays readable. On a handoff the successor is a new
session with its own id: it starts its own file, and the predecessor's stays as its last snapshot.
It's a short snapshot of that member's goal, decisions, state, and next step — updated at
milestones (assignment accepted, a material decision, a blocker, completion), not every turn.

After a compaction, reread `run.md` and every member's file before acting — they're the head start
that survived what your own context didn't.

## Keep the traffic small

`message-session` owns address resolution and note sizing. Load it before your first message of
the run, and **put it in every brief**: tell the peer to load it before it reports back, because a
peer's five-page report costs you what your five-page brief cost it, and a peer that never read
the skill has no reason to know that.

Reports up to your user follow the same shape for a different reason: they can open any peer's
pane themselves, and they will ask when they want more. So carry the major issues and decisions —
blocked, merged, needs you — and leave the rest. Re-narrating a peer's report pays for that report
a second time and tells your user something they could already see.

## Trust the peer's pipeline

A peer running its own pipeline has already had a review stage, and output it pasted from a
command in the same checkout you would verify from is evidence: re-running its greps re-proves
what it proved, and lands the output in your window twice. Verify before a merge or a deletion, on
a major decision, when your user asks, or when that peer has been wrong more than once — and
dispatch a subagent (`using-subagents`) so the evidence doesn't land in your window. A
recommendation out of proportion to the finding behind it is a decision, not a report: put it to
your user.

You are not the reviewer. Don't add code-shape requirements to a "go" or reopen a pipeline past
its stop condition; review from here only for a reason you can state, and keep it targeted. The
gate you hold is merge.

## Wait by subscribing, never by polling

A subscription costs the peer nothing and buys you one notice, delivered when that session next
ends a turn with nothing queued — the same moment that sets `status` to `waiting` — or exits,
which sets it to `null` instead.
`SendMessage({to: "<name>", notify_when_idle: true})` with `message` omitted subscribes without
delivering anything; include one to do both at once. Three properties decide how to use it:

- **It carries no content.** The notice says _when_ to look, never _what_ happened; substance
  comes from the peer's own report, which is why the brief asks for one. Use the subscription
  as the backstop for the peer that dies, or goes idle without reporting — and subscribe while
  it is still `working`. It fires on the _next_ idle transition, so a peer already `waiting` is
  one you read, not one you wait on.
- **It is one-shot.** A session that goes idle, receives another message, and works again will
  not notify you a second time — that notice fired and is spent, so a later round needs its own
  subscription — spend it again only where a report won't already cover it: where the brief
  mandates a report, the notice lands beside a report you already have and adds nothing; where
  the peer might go silent instead of reporting, that notice is the only signal you'll get.
- **It can expire**, and says so when it does. That means "no news", not "still working" —
  re-subscribe, or read `recap`, before concluding anything.

Dispatch and subscribe from the main thread: a subagent's messages go out under its parent's
address, so replies land in the parent's conversation rather than its own. And don't loop on
`garden ls` — one filtered `ls --live --status waiting` is how you read a recap and it is cheap;
what burns context is repeating it, and no amount of repetition makes the list answer "done or
stuck".

## Status does not mean what it looks like

`status` is derived from Claude Code hooks, so it reports what a hook fired, not what a session
means:

| status           | what actually set it                                        |
| ---------------- | ----------------------------------------------------------- |
| `working`        | a turn started, a tool ran                                  |
| `needs-approval` | a permission request, or a permission prompt                |
| `waiting`        | the turn ended, or a non-permission notification arrived    |
| `unknown`        | no hook has said otherwise                                  |
| `null`           | the session is dead; `liveness` and `exitCode` speak for it |

So **`waiting` means Claude stopped talking.** A pipeline that finished an hour ago and one
stalled on a question it asked an hour ago are both `waiting`, and `status` alone cannot separate
them. `statusReason` carries the notification's text, `lastActivity` its age, and `recap` the last
thing the session said — read those first; usually they settle it. When they don't, ask: a message
costs one turn and gets an answer written for you rather than inferred, so ask for a couple of
lines, not a write-up.

`needs-approval` is narrower than it sounds too — a permission prompt specifically, not any kind
of being-stuck — and it waits on a **person**. Surface it to your user with what it asks for.
Don't answer for them, and don't hand the work to a session with looser settings: a peer acting
on a permission your user hasn't granted launders the decision they were being asked to make. In
reverse too: if a peer asks you to run what its own permissions refused, refuse, and tell your
user.

## Watch the context budget, report it, don't act on it

A peer's context fills as it works, and a session near the end of its window gets worse at its
job before it says anything about it. `<skill base directory>/scripts/context_tokens.sh` — the
directory announced when this skill loaded — takes a session id or a transcript path, needs `jq`,
and prints current occupancy in tokens. A number that drops means the session shed detail, not
that it is healthier.

Report a high number to your user with the session's name and what it is working on, and let them
decide; handing off to a fresh session is their call. There is no threshold that means "act" —
the right number depends on the model behind that session, on whether subagents carry most of the work, and on how
close the task is to done.

## Relay findings between peers

Sessions running the same kind of work hit the same obstacles, and each one rediscovering a stale
path or a broken assumption costs a full debugging round. When one peer finds something the others
will hit, send them three lines about it.

## Winding down

The asymmetry decides it. A session is resumable, so killing one early costs a `garden resume`
plus the turn it was mid-way through, and it comes back at a new address — re-resolve after every
resume. An unanswered gate stalls indefinitely and nothing will tell you. So kill on evidence,
not on ceremony: a peer that reported done is evidence, and so is your user saying kill it. Only
when nothing has reported and the status is ambiguous do you read `recap` or ask.

That's winding down a peer. Replacing _yourself_ — while your swarm keeps running — is a
different move: `garden handoff --to <id>` when an existing session should take over, or `garden
new <dir> --handoff --json` to spin up a fresh one. Either way the whole swarm transfers in one
call — your `parent`/`swarmId` moves to the new session, your children move with it, and you get
`successor` set — instead of leaving your children parentless. Both verbs act on the _calling_
session's own place (they read your own `GARDEN_SESSION_ID`): this is something you do to end
your own run, never something you do to a peer.

If you've also written a `.handoffs/*.md` file for the successor (`session-handoff`), add
`--handoff-file <path>` to the same `garden new --handoff` call — the new session's first prompt
becomes a continue-from-handoff prompt that `session-pickup`'s own trigger picks up automatically,
no separate invocation needed. `garden handoff --to` has no file-carrying counterpart: it targets a
session that already exists, so point it at the handoff yourself in the message you send.

Winding down one peer or replacing yourself both leave the run folder in place — the swarm is still
running and other members still need their files. Remove `.orchestration/<run>/` only once every
member is wound down, no successor is taking over, and you are ending your own run too: with the
whole swarm gone, nothing left will read the folder, and nothing else will clean it up. Don't
delete it while any peer might still be running — a peer mid-write to its own file has no way to
know its file just disappeared.
