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

`garden new <dir> --json` returns `id` and `tmuxName`. Neither is the address you send messages
to — see "Two naming systems" below. The id exists before the peer does, so a resolve that misses
right after `new` means not-yet-started: retry before concluding anything.

Give a peer somewhere of its own to work: a worktree per task, not a shared checkout. Two sessions
in one working directory fight over the index and the branch, and neither will report that as the
cause of whatever breaks.

**Ask for a report in the brief.** You can ask later, but only if you know to, and a peer never
asked goes silent on completion, leaving you to infer it from signals that cannot carry it. Say:
message `<your session name>` when you finish, and immediately if something blocks you — spell
your own name out, because the peer cannot derive it — and say what the report holds: a pointer
to the result, its state, and what it needs from you. A peer left to pick the shape writes the
whole story. Write the rest of the brief to stand alone;
the peer shares none of your context, and `message-session` covers what a note needs to survive
the trip.

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
belongs to one process: resume or restart a session and it comes back under a different one, so a
name quoted from memory is stale the moment its process is — and a misdelivered note fails
silently in both directions.

When you report to your user, use the Claude Code name — that's what renders in the web console's
pane header, not the garden/tmux name. The web console never shows the id itself; for that, use
`garden ls` or `message-session`'s `resolve_session.sh`. The tmux name still answers a different
question and stays in the vocabulary for it: which pane to attach a terminal to — and, when two
live sessions share a messaging name, which `ListAgents` row is yours, since `ListAgents` prints
the tmux target beside each session running under tmux.

The two also disagree about `status`: the script prints Claude Code's registry word (`idle`,
`busy`, `shell`), garden's `status` column is derived from hooks (the table below). Neither is
wrong; they are different sources answering different questions.

## Write the run down

Everything else here travels as prose through context windows, and a window is the one place
state does not survive: yours fills up, a peer dies, an address changes on resume, and what you
knew goes with it. So keep the run's state in a file — `.orchestration/<run>.md` in the repo you
are orchestrating from, named for the run — ignored through `.git/info/exclude` where the repo
doesn't already ignore it, which keeps the run out of git without dirtying a tracked file. Give
peers its **absolute** path in the brief: an untracked file exists only in your checkout, and the
same relative path in a peer's worktree is either missing or a different run's file.

The file holds only what no other system holds, in four parts:

```markdown
# settings-ui — started 2026-09-21

merge: ask-human (approver: <name>) · create-issue: auto

## Tasks

- 6f1c9e2a-3b7d-4c58-9a0e-2d4f8b1c7e35 — #159 config schema + client read path — plan: /Users/dev/garden/docs/plans/159.md
- b2d84a17-5e60-4f9b-8c3a-71e5d9f0a246 — #160 settings UI

## Blocked

- #160 — waiting on user: which launch commands to list (asked, unanswered)
- #159 — user answered "SSM, not env"; peer not yet told

## Decisions

- user: settings read path is client-only, no server proxy
- user: proxy through the server after all (supersedes client-only — CORS blocked the direct read)
```

Tasks is which task went to which session and what it is. Blocked is the event that unblocks
each stalled task, not a status: "waiting on your user", "answered but the peer hasn't been told"
and "peer has it and is working" look alike in a status field and need three different things
from you. Decisions are appended, never edited, with who made each and on what — a reversed
decision and the reason it was reversed are both things nothing else on disk holds, and tidying
the first deletes the second.

Nearly everything else already has an authoritative home and belongs there. `garden ls` gives
cwd, branch, liveness and status; git gives commits and worktrees; GitHub gives PR, CI and review
state. A copy here is a second answer that can only go wrong — a green CI line is about a commit,
not about a time, so it goes stale the moment a peer pushes no matter how recently you wrote it.
Point at plans, PRs and commits rather than summarizing them, and when the file disagrees with
git, GitHub or garden, they win. The file is authoritative only for the intent and the decisions
nothing else records.

Identify a session by its session id — stable across resume — never by the messaging name, which
changes every time the session restarts, so a stale one in a file is a misdelivered note later
with no error in either direction. The task label beside it is what keeps the file scannable,
and a file nobody scans stops being updated.

Write to it when one of those facts changes — a dispatch, a block or unblock, a decision — and
not otherwise. That keeps it small enough that updating it never becomes a task of its own, and
it is what makes the file worth reading: one that changes only on those events says something by
having changed. You are the only writer. Peers read it and report their deltas to you; several
sessions editing one file with no locking lose each other's updates silently, and the machinery
that would fix that costs more than the file is worth. It follows that the file is only as
current as your last update — a head start for a session picking the run up, not a statement of
where things stand.

## Keep the traffic small

`message-session` is where note-sizing lives, and it is also the only sound way to resolve a
peer's address, so load it before your first message of the run — and **put it in every brief**:
tell the peer to load it before it reports back. Verbosity is symmetric. A peer that sends you a
five-page report costs you exactly what your five-page brief cost it, and a peer that never read
the skill has no reason to know that.

The part worth holding here: a note stands alone when the recipient can act without coming back
to ask you, which is not the same as carrying everything it needs. Detail that already lives in a
file, a PR, or the run's state file travels as a pointer and a reason to open it.

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
