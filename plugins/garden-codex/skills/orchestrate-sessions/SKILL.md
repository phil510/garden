---
name: orchestrate-sessions
description: >-
  Create and oversee Codex garden sessions with garden new, ls, send, adopt, resume and kill.
  Use for "spin up sessions for these issues", "start a session in this repo", "check on the
  sessions I started", or "wind these down". Use message-session to compose a peer's brief
  and watch-pr to wait for PR activity. Server shutdown belongs to garden stop.
---

# Orchestrating Codex garden sessions

Garden owns tmux panes; each peer is an independent Codex conversation that survives the
orchestrator ending. Native subagents are different: use the collaboration tools actually
exposed in this session for bounded work you need to collect here. Plugin Markdown agent
files do not provide Codex agent types.

## Dispatch and collect

1. Check `GARDEN_HARNESS=codex` and `GARDEN_SESSION_ID` are set. Keep the full inherited instance
   environment so custom port, app dir and tmux socket still reach the server that spawned you.
   From an outside shell, select the intended instance explicitly before creating peers.
2. Give each writer a separate worktree and explicit file ownership. Tell peers they share the
   repo and must preserve unrelated edits. Pass model or effort overrides only when the user's
   direction calls for them; peers do not inherit this conversation's model or permissions.
3. Run `garden new <absolute-worktree> --json`. Record its `id`, then use `message-session` and
   `garden send <id> <brief>` to dispatch. The id exists before the first Codex prompt. Include
   your own garden id as the return address, the run-file path, and the expected report.
4. Collect reports with result pointers, validation and open decisions. `garden ls --json`
   shows liveness and status; `waiting` alone does not mean success. A working peer may be
   blocked on a question. Ask it for the missing result rather than deriving completion from
   status or reading every transcript.

Useful commands:

```sh
garden ls --json
garden ls --live --json
garden adopt <id> --json
garden resume <id> --json
garden kill <id>
```

`adopt` changes grouping, not the peer's assignment. `kill` ends its process; resume continues
its conversation when one exists. Do not kill yourself expecting to issue your own resume.
Consult `garden` usage and the current CLI source for additional flags, rather than
copying Claude-specific model names or a stale command reference.

## Keep a durable run

For work spanning many peers, keep a local run directory outside committed artifacts. Record
the objective, constraints, dependencies, member ids, worktrees, draft PRs, open decisions and
next action. Give each peer its own member file; each writes only its own file. Reports point
there rather than pasting full plans into the orchestrator's context.

Set review and merge policy in each brief before dispatch. For a large run, separate drafting
from demand on the human: peers can draft in parallel, while questions and review requests
wait for their dependency wave. A peer waiting at a draft PR still owns that assignment.
Release only the next wave that can be assessed, and preserve the user's approval policy
through every nested dispatch. Never treat permission in another session as a new grant here.
