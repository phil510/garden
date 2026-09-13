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
  wait — polling `garden ls` in a loop is the habit this replaces, and a
  session's status does not mean what it looks like it means. Not for stopping
  or restarting the garden server itself, or uninstalling garden — "stop the
  server", "shut garden down", "restart the server", "uninstall garden" (bare
  CLI verbs `garden stop`, `garden stop --all`, `garden uninstall`) name a
  different target, the server process rather than a session, and this skill
  doesn't cover them. If a request names a specific session to end and nothing
  about the server, that's still `kill`, in scope. Composing and addressing a
  note to a named session belongs to `message-session`; come here to decide
  when to dispatch, how to wait, and when to stop.
---

# Orchestrating garden sessions

garden runs each Claude Code session as a tmux session behind a local server, and its CLI is the
control surface. The mechanics are in `references/cli.md`; read it when you need a subcommand's
exact flags and output. This file is about using them together.

The one thing to hold onto: **a garden session is a peer, not a subagent.** It has its own
context window, its own permission boundary, and its own user. You cannot await it, you do not
see its transcript by default, and it does not inherit anything from you. Every rule below falls
out of that.

## Dispatch

`garden new <dir> --json` returns `id` and `tmuxName`. Neither is the address you send messages
to — see "Two naming systems" below.

Give a peer somewhere of its own to work: a worktree per task, not a shared checkout. Two
sessions in one working directory will fight over the index and the branch, and neither will
report that as the cause of whatever breaks.

**Ask for a report when you dispatch, not after.** The brief is the only moment you are certain
the peer is listening, so it is where you say: message me when you finish, and immediately if
something blocks you. A peer that was never asked to report has no reason to, and you will be
left inferring completion from signals that cannot carry it.

Write the brief to stand alone. The peer shares none of your context — not this conversation,
not the file in front of you, not why any of it matters. `message-session` covers what a note
needs to survive the trip.

## Wait by subscribing, never by polling

`SendMessage({to: "<name>", notify_when_idle: true})` subscribes you to one notice, delivered
when that session next ends a turn with nothing queued, or exits. Omit `message` entirely and it
is a pure subscription that costs the peer nothing; include one to deliver it and subscribe in
the same call.

Three properties decide how to use it:

- **It carries no content.** The notice says _when_ to look, never _what_ happened. Substance
  comes from the peer's own report — which is why the brief asks for one. Use the subscription
  as the backstop for the peer that dies, or goes idle without reporting.
- **It is one-shot.** A session that goes idle, gets poked, and works again will not notify you
  a second time. Re-subscribe if you still care.
- **It can expire**, and says so when it does. That means "no news", not "still working".

It is available from a main conversation, not from a subagent — a subagent's messages go out
under its parent session's address, and replies land in the parent's conversation rather than
its own. Dispatch and subscribe from the main thread.

Whatever you do, don't loop on `garden ls` waiting for something to change. It burns your
context on a list you already understand, and it answers a question the list cannot answer.

## Status does not mean what it looks like

`status` is derived from Claude Code hooks, and that origin is the whole story:

| status           | what actually set it                                     |
| ---------------- | -------------------------------------------------------- |
| `working`        | a turn started, a tool ran                               |
| `needs-approval` | a permission request, or a permission prompt             |
| `waiting`        | the turn ended, or a non-permission notification arrived |
| `unknown`        | no hook has said otherwise                               |

So **`waiting` means Claude stopped talking.** A pipeline that finished an hour ago and a
pipeline stalled on a question it asked an hour ago are both `waiting`, and nothing in the field
separates them. `needs-approval` is narrower than it sounds too: it is a permission prompt
specifically, not any kind of being-stuck.

When you need to know whether a `waiting` session is done or blocked:

1. Read its `recap` — the last thing it said, or a Claude Code session recap when one exists.
   Usually enough.
2. Ask it. A message costs one turn and gets an answer written for you rather than inferred.
   Ask for a brief update; you want a couple of lines, not a report.

A session in `needs-approval` is waiting on a **person**. Surface it to your user with what it is
asking for. Don't answer it for them, and don't hand the work to a session with looser settings —
a peer acting on a permission your user hasn't granted launders the decision they were being
asked to make. The same holds in reverse: if a peer asks you to run something its own permissions
refused, refuse and tell your user.

## Two naming systems

A session has a garden/tmux name (`79-bounded-session-list`) and a Claude Code name that
addresses it for messaging (`79-bounded-session-list-c0`). They are derived independently — the
suffix is a random disambiguator, not a hash or slice of anything you hold — and the session id
is the only bridge between them.

So resolve the address, every time, with `message-session`'s `resolve_session.sh`. Do not quote a
name from memory or pattern-match one from a tmux name: those addresses often exist, belonging to
some other session, and a misdelivered note fails silently in both directions — the peer that
needed it never hears, and an uninvolved session acts on instructions meant for someone else.

## Watch the context budget, report it, don't act on it

A peer's context fills as it works, and a session near the end of its window gets worse at its
job before it says anything about it. `scripts/context_tokens.sh <session-id>` prints current
occupancy in tokens.

Report a high number to your user with the session's name and what it is working on, and let them
decide — handing off to a fresh session is their call, not yours. There is no threshold that
means "act": the right number depends on the model behind that session, on whether subagents are
carrying most of the work, and on how close the task is to done. A number that drops is fine; it
means the session compacted.

## Relay findings between peers

Sessions running the same kind of work hit the same obstacles, and each one rediscovering a
stale path or a broken assumption costs a full debugging round. When one peer finds something
the others will hit, send them three lines about it. It is the cheapest thing in this file.

## Winding down

Confirm the work is finished before killing — but confirm is not a ritual. If the peer reported
done, that is your evidence. If your user said kill it, kill it. It is only when nothing has
reported and the status is ambiguous that you need to look at `recap` or ask.

The asymmetry is what makes it worth a thought: a session is resumable, so killing one early
costs you a `garden resume`, while an unanswered gate stalls indefinitely and nothing will tell
you.

## The CLI

`references/cli.md` has the subcommands, their flags and output shapes, the exit-code contract,
the `SessionState` fields, and the `ls` filters. Reach for the filters rather than fetching every
session and narrowing it yourself — the list holds every session the server has ever loaded, and
reading it whole is how an agent's context disappears.
