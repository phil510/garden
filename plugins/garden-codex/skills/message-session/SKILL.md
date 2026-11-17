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

## Resolve, compose, send

Use the full `id` returned by `garden new --json`, or find it with `garden ls --json`. Confirm
its cwd and task match the intended recipient. A title, tmux name, native Codex id, or a name
from another harness is not an address. If several rows fit, ask which one; never choose by
recency. Stay in the Codex instance selected by the inherited `GARDEN_*` environment.

Write the note so it can be acted on cold: what to do, exact ownership, constraints, and what
to report to whom. Point to existing files with absolute paths, and qualify issues, commits
and PRs with the repo. A large new explanation belongs in a local run file the recipient can
open. A completion report usually needs only the result, its pointer, and what you need back.

Pass the message as one argument, using the execution tool's argument support or safe shell
quoting. Do not interpolate untrusted text into shell code.

```sh
garden send <full-garden-id> '<message>'
```

A successful send means accepted for delivery, not that the peer read it or finished. Pending
sessions receive their first prompt; bound sessions enqueue against their current conversation.
A dead or unknown recipient, or an unavailable server, is a failure to report and resolve;
never redirect to a nearby peer. Name the destination id when reporting a send to the user.

Sending still requires the user's authorization or a workflow they invoked that authorizes it.
