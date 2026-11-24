---
name: message-session
description: >-
  Send a brief, question, report, or handoff to another Codex garden session, including a peer
  you started or the session that briefed you. Use when a recipient is a garden session id,
  when the user says "message that session", or when dispatching work after garden new.
---

# Messaging another garden session

A garden peer has its own conversation. Address it by garden's stable id so a `/clear` cannot
send your note to its old Codex conversation. Native subagents in this conversation use the
collaboration tools exposed by this harness instead; their handles are not garden ids.

## Resolve the recipient

Use the full `id` returned by `garden new --json`, or find it with `garden ls --json`. Confirm
its cwd and task match the intended recipient. A title, tmux name, native Codex id, or a name
from another harness is not an address. If several rows fit, ask which one; never choose by
recency. Stay in the Codex instance selected by the inherited `GARDEN_*` environment.
When replying to a peer, use the Garden UUID in the `[Message from session …]` header.
The `[Message from external shell]` header identifies a send without a peer reply address.

Cwd and recency only narrow the candidates: several live sessions usually share a repo, and two
started minutes apart make recency a coin flip. A misrouted note is worse than an undelivered
one — the session that needed the information never gets it, and a bystander acts on instructions
meant for someone else — so when `garden ls` has no answer, report that instead of nominating the
closest match.

## Write the note so it survives the trip

The recipient shares none of your context — not the conversation, not the file
in front of you, not the reasoning that got here. It reads the note cold,
mid-task, in another repo. So "let's fix this upstream", which is perfectly
clear where you are, is unactionable there.

But standing alone means the recipient can act without coming back to ask you,
not that the note carries everything it will need. Reading it as the second
thing turns a note into a pasted file, which both windows then carry for the
rest of the run — and the recipient opens the file anyway for the part you left
out. Point instead, and say why to look. Provenance decides this, not length:

- **It already exists somewhere the recipient can open** — a file, a PR, an
  issue, a commit, a run's state file. Point at it however small the excerpt
  would be, and don't summarize it either: a summary is the file in your words,
  which the recipient reads and then opens the original to check. The reason to
  look is one line — "`/Users/dev/api/docs/plans/x.md` §3 — its retry budget
  contradicts your task 4". File paths absolute, PRs, issues and commits
  repo-qualified: the recipient is in another worktree, often another repo,
  where your relative path resolves to nothing or to the wrong file.
- **It doesn't exist yet and it's substantial** — write it down, then point.
  Having nothing to cite is where pasting starts. What earns a file is what the
  recipient can't regenerate; output it could get by running the command itself
  is a command, not an artifact.
- **It doesn't exist yet and it's small** — just say it. A file for three
  original lines is its own overhead.

A brief is where this bites hardest, because nearly everything a brief wants to
say already exists: the issue, the plan, the acceptance criteria, the repo's
own docs. What is new in a brief is the direction — what to do, where, under
what policy, and what to report to whom — and that is what it carries. The
rest is pointers.

Everything after the brief — updates, acks, answers, relayed decisions,
completion reports — is a few lines: what happened, where to look, and what you
need back (a fix, a decision, or nothing). Quote a decision rather than
glossing it, and name a finding with identifiers the recipient can act on —
paths, symbols, error text, ticket ids, which repo hit it. A completion report,
in full:

> #142 done — PR helloextend/garden#170, CI green, ready to merge. Nothing
> needed from you.

Both shapes are shorter than they feel while writing, because you hold the
whole picture and the recipient needs only the part that changes what it does
next.

## Send

Pass the message as one argument, using the execution tool's argument support or safe shell
quoting. Do not interpolate untrusted text into shell code.

```sh
garden send <full-garden-id> '<message>'
```

A successful send confirms transport acceptance. A pending session uses its launch path for the
first prompt and a bound session enqueues against its current conversation. Use a reply or
independently verified state to confirm the peer acted. A dead or unknown recipient, or an
unavailable server, is a failure to report and resolve. Never redirect to a nearby peer.

Report to the user what you sent and to which id — routing is the part they cannot see, and they
may know the recipient is wrong. When sends are the mechanics of a larger job you are already
describing, still name the route; what drops is restating the note's body.
