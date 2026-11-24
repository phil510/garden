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

## Write a note the recipient can act on

Give the action, exact ownership, constraints and what you need back. Point to evidence the
recipient can open and say why it matters. Use absolute file paths and repo-qualified issues,
PRs and commits because the recipient may be in a different worktree. Put substantial new material
in a run file the recipient can open. Keep updates and completion reports to a few lines with the
result, its source and the next action, if any. Quote a relayed decision and identify who made it.

For a stacked ship-it handoff, name the action (review hold, base hold, upstream fix or sync,
review release), the target PR and its workflow path if known. Name the affected upstream PR or
base and point to the fix or integration evidence. A release identifies the exact PR head, base
ref and tip, and the main tip verified. The receiving ship-it owner records the decision in its
existing workflow before acting and replies with the durable pointer and resulting state so the
parent can tell when the gate actually took effect.

## Send

Sending requires the user's authorization or a workflow they invoked that authorizes it.

Pass the message as one argument, using the execution tool's argument support or safe shell
quoting. Do not interpolate untrusted text into shell code.

```sh
garden send <full-garden-id> '<message>'
```

A successful send confirms transport acceptance. A pending session uses its launch path for the
first prompt and a bound session enqueues against its current conversation. Use a reply or
independently verified state to confirm the peer acted. A dead or unknown recipient, or an
unavailable server, is a failure to report and resolve. Never redirect to a nearby peer. Name
the destination id when reporting a send to the user.
