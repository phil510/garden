---
name: message-session
description: >
  Use when sending a message, note, question, or handoff to another Claude Code
  session — including every case where the recipient was given as a session name
  or session id rather than confirmed against ListAgents. Triggers include "send
  a note to the agent in session <uuid>", "message <session-name>", "tell the
  session working on X", "ask the other session about this", "forward this
  upstream to that session", "let the CDK session know", and a bare session name
  or id accompanied by any intent to contact it. Also covers looking up a
  session's working directory or transcript path. Resolve the address with the
  bundled script before calling SendMessage rather than reasoning about which
  session is meant — a name's suffix cannot be derived from the session id, so
  the alternative is guessing, and a wrong guess delivers to a real but
  unintended session with no error.
---

# Messaging another session

This is for sessions you did not start: other Claude Code windows on this
machine. Subagents and teammates you spawned already have names you hold, so
call `SendMessage` directly for those.

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
slice of the session id, pid, or start time reproduces it. So every shortcut is
unsound:

- Ranking transcript mtimes or start times against session recency is
  circumstantial. Two sessions started minutes apart in one repo — routine when
  several run at once — make it a coin flip.
- Filtering by cwd yields a candidate set, not an answer. Several live sessions
  usually share a repo.

A misrouted note is worse than an undelivered one: the session that needed the
information never gets it, and an uninvolved session acts on instructions meant
for someone else. When the registry has no answer, report that instead of
nominating the closest match.

## 2. Write the note so it survives the trip

The recipient shares none of your context — not the conversation, not the file
in front of you, not the reasoning that got here. It reads the note cold,
mid-task, in another repo. So "let's fix this upstream", which is perfectly
clear where you are, is unactionable there.

Name the finding with identifiers the recipient can act on (paths, symbols,
error text, ticket ids), say which repo hit it, and say what you want back — a
fix, a decision, or nothing.

Length follows the job. A note that starts a session's work, or changes it — a
rescope, a different approach — carries as much as that direction needs to
stand alone. Everything after is a few lines: an update, an ack, an answer, a
decision relayed from a person. Where the detail already exists somewhere the
recipient can open — a path, a PR number, a round file — point at it instead of
restating it; the pointer stays current and a paraphrase doesn't.
`orchestrate-sessions` has the why, which compounds when one session is running
several peers.

## 3. Send

Send only on exit `0`, passing the resolved `name` to
`SendMessage({to: "<name>"})`. `status` sets expectations rather than gating the
send: `idle` means the note lands on the peer's next turn, `busy` means it is
mid-task.

Report to the user what you sent and to which name — routing is exactly the part
they cannot see, and they may know the recipient is wrong.

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
`ListAgents`, which the registry does not record. Match the script's start age
against the `started … ago` column in `ListAgents` to pick the right ref.
