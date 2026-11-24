---
name: message-session
description: >
  Use when sending a message, note, brief, question, report, or handoff to
  another Claude Code session — any session outside your own process, whether or
  not you started it. Triggers include "send a note to the agent in session
  <uuid>", "message <session-name>", "tell the session working on X", "ask the
  other session about this", "forward this upstream to that session", "let the
  CDK session know", a bare session name or id accompanied by any intent to
  contact it, and every case where the recipient was given as a session name or
  session id rather than confirmed against ListAgents. Also covers dispatching a
  brief to a session you launched yourself, reporting back to the session that
  briefed you, and looking up a session's working directory or transcript path.
  It carries what a note must say to be actionable cold, and what belongs in a
  file the recipient can open instead. Resolve the address with the bundled
  script before calling
  SendMessage rather than reasoning about which session is meant — a name's
  suffix cannot be derived from the session id, so the alternative is guessing,
  and a wrong guess delivers to a real but unintended session with no error.
---

# Messaging another session

This is for any Claude Code session outside your own process — another window on
this machine, a peer you launched yourself. Whether you started it makes no
difference, because the name that addresses it is assigned by that process and
cannot be derived from anything you hold. Only in-process subagents and
teammates arrive with names you already have; those you message directly.

Sending has three parts: get a valid address, write a note that stands on its
own, then call `SendMessage`. The address step is the one that silently goes
wrong, so it is mechanical here.

## 1. Resolve the address

`SendMessage` addresses a peer by **name** (`extend-cdk-14`), but people refer to
sessions by whatever is in front of them, usually an id. The script takes either:

```bash
S=<skill base directory>/scripts/resolve_session.sh   # the directory announced when this skill loaded
"$S" <name-or-id>            # name, full id, or id prefix
"$S" <name-or-id> --json     # always a JSON array, whatever the outcome
"$S"                         # list every live session
```

Use that absolute path — the working directory is the project, and a bare
`scripts/…` either fails or hits an unrelated script the repo ships.

It prints name, session id, cwd, status, start age, and transcript path. It
reads `~/.claude/sessions/<pid>.json`, the registry Claude Code keeps for live
sessions, which states the id↔name pair outright. Requires `jq`.

The exit code is the verdict; check it rather than parsing the text. Only `0`
permits a send — the rest are covered in "When resolution fails". A record's
`matchedBy` says how it matched; `name-substring` means a partial name happened
to be unique, which is deterministic but a guess at intent, so confirm before
sending on one.

### Never infer the mapping

The derived name's suffix (`-14`, `-c3`) is a random disambiguator — no hash or
slice of the session id, pid, or start time reproduces it. Cwd and recency only
narrow the candidates: several live sessions usually share a repo, and two
started minutes apart make recency a coin flip. A misrouted note is worse than
an undelivered one — the session that needed the information never gets it, and
a bystander acts on instructions meant for someone else — so when the registry
has no answer, report that instead of nominating the closest match.

## 2. Write the note so it survives the trip

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

## 3. Send

Send only on exit `0`, passing the resolved `name` to
`SendMessage({to: "<name>"})`. `status` is the registry's word for what the
peer is doing (`idle`, `busy`, `shell`, or `?` when unset) and predicts timing,
not permission: `idle` lands on the peer's next turn, the rest wait for one.

Report to the user what you sent and to which name — routing is the part they
cannot see, and they may know the recipient is wrong. When sends are the
mechanics of a larger job you are already describing, still name the route;
what drops is restating the note's body.

## When resolution fails

- **1 — not found.** The script says which case: a transcript with no registry
  entry means the session has exited and cannot be messaged (its transcript is
  still readable) — say so rather than redirecting to a live sibling in the same
  repo. Nothing found anywhere means a wrong id, or another machine.
- **2 — ambiguous.** Candidates on stderr. Ask which, or take the full id;
  never pick one.
- **3 — resolved but not reachable.** Name and id are right but nothing is
  listening, so the note would vanish silently — the failure this skill exists
  to prevent. The script says which case: process gone (treat as exited), or
  alive with no messaging socket (unreachable, not dead).
- **64 / 69** — bad usage / `jq` not installed.

Two live sessions can share a name, since the suffix is random; exit `2` on an
exact name is that case. `SendMessage` then needs the `[ref]` from
`ListAgents`, which the registry does not record and which is not a slice of
the session id. Once the exact name has narrowed the candidates, joining on a
column both tools show is sound where inferring a name from recency was not: a
tmux target you know is yours, or a clearly distinct start age. Two ages within
a minute of each other remain ambiguous — ask.
