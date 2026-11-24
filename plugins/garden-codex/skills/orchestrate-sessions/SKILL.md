---
name: orchestrate-sessions
description: >-
  Create and oversee Codex garden sessions with garden new, ls, adopt, resume and kill.
  Dispatch peers, recover a swarm, and coordinate stacked PRs and review release. Use for
  "spin up sessions for these issues", "start a session in this repo", "check on the sessions
  I started", or "wind these down". Use message-session for notes to a named peer and watch-pr for PR activity.
  Server shutdown belongs to garden stop.
---

# Orchestrating Codex garden sessions

Garden runs each peer in tmux. Each peer has its own conversation and permissions and can keep
working when you stop. Use native Codex subagents for bounded work you need to collect within this
conversation. Garden peers use the CLI and report back by message.

## Dispatch owners

Check that `GARDEN_HARNESS=codex` and `GARDEN_SESSION_ID` identify your Garden session. Keep the
inherited instance environment so custom port, app dir and tmux socket still reach the same server.
Outside Garden, select the intended instance explicitly (`garden --codex …`). Without a Garden
caller id, new peers are ungrouped. Say so before dispatching if the run needs a parent.

- Give each writer its own worktree and explicit scope. Reuse a peer when its assignment is
  finished and the next task needs the same context. A draft or ready PR awaiting a gate still
  has an owner. Start a fresh peer for work that needs its own pipeline.
- Run `garden new <absolute-worktree> --json` to spawn a peer under your session, or `garden adopt
<id> --json` to group an existing one. Retain the Garden UUID, which survives changes to the
  native conversation. A visible session name can help the user find a pane. Use the UUID for
  tracked operations and messages. Once the peer appears in `garden ls --json`, confirm its
  `parent` equals your `GARDEN_SESSION_ID`. If ungrouped, check the instance and caller id, then
  adopt it before counting it as a child.
- Pass model and effort overrides on `new` and `resume` only if the user's direction calls for
  them. Peers use their own defaults and permissions. A bare resume sends no overrides.
- Load `message-session` before you send the brief and tell each peer to use it when reporting.
  Include the task, constraints, worktree and ownership, your return UUID, the run folder's
  absolute path, and when to report. Ask for a short report at a milestone, at completion, or
  when blocked, with the result pointer and any decision or action you owe.
- Name the merge policy, approver, and issue-creation authority before dispatch. Give peers no
  greater authority than you have, and pass these bounds through any nested swarm.

A relayed decision can unblock scope or design work. Tell the peer promptly, and ask it to report
authorial decisions it receives directly so you can relay them to affected peers. A merge gate,
irreversible action, action outside the peer's authorized scope, or permission prompt follows
its own approval policy. A `needs-approval` status calls for the human at the original prompt.
Surface it immediately, including in a later wave. Keep the action with its authorized owner.

## Keep the run recoverable

For a swarm or stack, use an untracked run folder such as `.orchestration/<run>/`. You alone write
`run.md`. Record the objective, authority and integration plan, ownership by Garden UUID,
dependencies and blockers. Name the event that unblocks each peer and the next action when it
occurs. Log who made each decision and why.

Each peer writes only its own `<session-id>.md` in that folder. Ask it to open with the assignment
and update the file at milestones with the PR or result, decisions, blockers and next action.
Reference GitHub for live PR, review and CI evidence, git for refs and worktrees, and Garden for
session state. The run file holds intent and decisions. After compaction or resume, read the run
and member files, then check whether any recorded blocker has cleared.

## Coordinate a stack

**Keep drafting parallel.** Brief stack peers to run `ship-it` through internal review, keep
their configured review loop, and pause at the draft before the pre-ready gate advances. Ask
them to report the draft and its verification or blockers. The peer still owns its PR and picks
up when you give the go-ahead. See [ship-it’s pre-ready gate](../ship-it/SKILL.md#4-pre-ready-gate).

**Verify the work together.** Run the stack end to end in a sandbox, or build and test a branch
that carries the combined changes for library-only work. Settle who owns a shared test
environment so overlapping writes do not invalidate the run.

**Relay upstream decisions as they land.** Tell affected peers which base is unsettled and have
them record the base hold in their ship-it brief so conflict handling does not pull it in. Once
the upstream change is settled and validated, have affected peers sync in dependency order.
For several updates, tell peers to batch and say when the batch is done so they hold ready and
merge and review the final head once. In the merge queue, bring up to date only the next PR
due for review or merge. Each merge moves the base again. See
[ship-it’s brief guidance on holds and batching](../ship-it/references/brief.md#mid-pipeline-user-concerns).

**Release review per PR.** Send the go-ahead once integration is verified, that PR’s own
dependencies have merged, and it is current with main. An independent PR can proceed while a
descendant waits. With configured bot loops, release one or two eligible PRs at a time. Ask
peers to report when a loop finishes or blocks so the next eligible PR can use the slot. With
`none`, the go-ahead lets the peer proceed through its normal ready gate without a bot slot.
Follow repo policy and explicit user overrides, such as reviewing before dependencies merge.
Merge authority still follows the brief.

## Pace a large swarm

For more than a handful of sessions, propose waves by dependency before dispatch. Let every wave
draft. Ask later-wave peers to record their questions and continue independent work. Open a wave
when its hard blockers have merged and at most one earlier wave is still open. A wave closes
when all its PRs have merged. Opening a wave lets its decisions, review, and merge requests reach
the human. Drafting can resume when its own blocker clears even before the wave opens.

Batch questions by wave and manual work by the window it shares, such as a time-limited login.
Maintain one merge-ordered status list with each PR and its blockers, plus the human's decisions
and actions. When a choice belongs to you and is cheap to reverse, act on a stated default, log
it, and relay it so the peer can continue. A material contract change or pivot waits for the
owner's decision. Hold affected peers at their next safe stopping point until the replacement is
settled.

## Handle reports and recovery

Act on reports, decisions and PR events as they arrive. Remove the recorded blocker and message
the authorized owner on the same turn when the evidence satisfies it. Reuse the peer's scoped
review and verification evidence. Independently check it when a merge, deletion or material
decision depends on it, when the user asks, or when earlier evidence has proved unreliable.

Use `garden ls --json` for a targeted diagnostic or status check. Use `--swarm <id>` to narrow
the run and `--live --status waiting` to inspect idle peers. Read `statusReason`, `lastActivity`,
`recap`, and, for an exited peer, `liveness` and `exitCode`. A `waiting` status marks a turn
boundary. A delivery ack marks transport acceptance. Use a short direct question if the report
or a source artifact is missing. Follow reports by message and use `watch-pr` for relevant PR
events instead of looping on `garden ls`.

Use `garden resume <id> --json` to recover a stopped peer if its work remains authorized. Use
the original run and member files and recheck current PR state before asking it to continue.
For a deferred check, relay the decision once to affected peers and use `watch-pr` for changing
the watch filter. Use the peer's own alert path when a human-only gate remains unanswered.

When a peer reports completion and you do not plan to reuse it, or the user asks to end it,
verify the intended UUID and ownership against `garden ls --json` (`parent` should match your
Garden id for your children), then `garden kill <id>`. Preserve its files while other peers still
rely on them. Worktree and branch cleanup belongs to the live PR owner. If it has exited and
you inherit cleanup, verify the terminal PR state and the worktree first.
