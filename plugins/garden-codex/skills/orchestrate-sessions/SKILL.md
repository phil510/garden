---
name: orchestrate-sessions
description: >-
  Create and oversee Codex garden sessions with garden new, ls, adopt, resume and kill.
  Dispatch peers, recover a swarm, and coordinate stacked PRs and review release. Use for
  "spin up sessions for these issues", "check on the sessions I started", or "wind these
  down". Use message-session for notes to a named peer and watch-pr for PR activity.
  Server shutdown belongs to garden stop.
---

# Orchestrating Codex garden sessions

Garden owns the tmux sessions. Each peer has its own conversation and permissions and can keep
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
  tracked operations and messages. If `new` reports `unknownCaller`, fix the grouping before
  counting the new peer as a child.
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
dependencies, release decisions and blockers. Name the event that unblocks each peer and the
next action when it occurs. Log who made each decision and why. Append superseding decisions
so a resumed run can recover their sequence.

Each peer writes only its own `<session-id>.md` in that folder. Ask it to open with the assignment
and update the file at milestones with the PR or result, decisions, blockers and next action.
Reference GitHub for live PR, review and CI evidence, git for refs and worktrees, and Garden for
session state. The run file holds intent and decisions. After compaction or resume, read the run
and member files, then reconcile outstanding blockers and releases against their owning sources.

## Coordinate a stack

**Keep drafting parallel.** Put the dependencies and integration check in each brief. Ask each
peer in the stack to run `ship-it` through internal review and pause at its draft PR before
external review or ready. Have it report the PR, reviewed head, base ref and tip, main SHA used,
verification pointers and remaining gates. Keep its configured review loop and merge policy in
the brief. The peer retains its assignment and is responsible for following through after
release. See [Stack holds and review release](../ship-it/references/brief.md#stack-holds-and-review-release)
for the durable handoff.

**Relay decisions as they land.** If an upstream PR needs another edit, tell affected peers what
changed and which base is on hold. Confirm each records the hold in its ship-it artifacts.
Independent work can continue. In a coordinated update, tell peers when the batch begins and
ends so intermediate heads do not spend review rounds or advance ready or merge. Once the
upstream heads settle and validate, synchronize affected peers in dependency order. During the
merge queue, bring up to date only the next PR whose review loop or merge is due. Verify and
review each final synchronized head once.

**Release per PR.** Keep a short queue of drafts and their outstanding gates. Release a PR
when its integration evidence is green, its own dependencies have merged, and the reviewed PR
targets and is current with main. Upstream work still under review can change the integration
result even if the descendant's SHA stays the same. Confirm the current PR head, base ref and tip, and
main SHA against the evidence before sending a release. Name those values and the verification
pointer in the message, and confirm the peer has recorded it. A later hold supersedes that release.
If any of those values change before dispatch or on recovery, get current evidence before release.

- Use sandbox integration evidence for behavior that needs it or builds and tests on the
  integrated code for library-only changes. Keep a shared environment stable for the test and
  serialize runs that write to it. Invalidate evidence if a change affects what it verified.
- Release one or two eligible configured bot loops at a time. An independent PR can advance on
  its own verified integration and dependencies. A free slot alone cannot release a descendant
  of an unmerged PR. Ask peers to message you when a configured loop ends, even when
  its PR still has gates. On `passed` or `blocked`, free that release's slot and dispatch the next
  eligible PR. Deduplicate by PR and release so late reports cannot free a newer slot.
- A PR configured with `none` uses the same release gate and goes directly to the normal ready
  gate without using a bot slot. Respect the repository's loop policy. An explicit early-review
  override can release a configured bot loop before dependencies merge and the PR is current with
  main. Base holds, the ready gate and merge authority still apply.
- When a dependency lands, wake owners who can now draft against it. For drafts in the merge
  queue, take the next eligible update or release as soon as its gates permit. A release grants
  only the action it names. Any merge follows the existing authority in the brief.

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
