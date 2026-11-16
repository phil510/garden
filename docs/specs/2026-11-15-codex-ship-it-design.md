# Codex ship-it: proposed native workflow

Status: proposal for discussion. Implementation waits for agreement. This design assumes the
Codex garden instance, message delivery and plugin work have passed their end-to-end checks.
The current draft stack has not established that yet.

## Complete flow

A Codex garden session owns the run. It turns the user's objective and project instructions
into a brief, records the scope and authorization, and starts native Codex children for planning,
implementation and independent review. Children write durable results before reporting. The
orchestrator records each accepted result and advances one stage at a time. A dirty review goes
to a fresh developer round, then an independent reviewer. Once internal review is clean, the run
stops at the user's chosen boundary: draft, ready for human review, or a separately authorized
merge policy.

If the run continues past draft, a garden PR watch supplies external activity. An owned events
forwarder enqueues each digest into the orchestrator's current conversation. The orchestrator
routes it to the one worker responsible for that stage, records the result, and checks current
GitHub state before any ready or merge action. If the orchestrator dies, the run files survive;
a new garden session resumes from those files and current repository/GitHub facts, with fresh
children and a new watch owner.

This replaces the Claude plugin's implicit team and monitor assumptions. It preserves its useful
workflow: thin briefs, workers owning stage work, independent review, explicit gates and recovery
from disk.

## Recommended execution model

Use native Codex children for stage workers. Give each worker an absolute role-reference path,
run-directory path, worktree, attempt id, exact file ownership and expected result. Role text is
loaded deliberately by the worker; a Markdown file under a plugin's `agents/` directory is not
assumed to register a Codex agent type. The plugin would ship a small `ship-it` skill plus role
and protocol references. It would not generate personal agent configuration or edit user settings.

Garden peers remain useful for several independent PRs. Each peer owns one pipeline; this skill's
planner, developer and reviewer are native children inside that pipeline. This keeps durable
cross-session routing on garden ids while using native child handles for bounded stage work.

| Operation               | Current native interface                          | Rule for this workflow                                                              |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Start a child           | `collaboration.spawn_agent`                       | Supply a self-contained brief and ownership; prefer fresh context for review.       |
| Talk to a running child | `collaboration.send_message`                      | Route only information needed by its current assignment.                            |
| Resume an idle child    | `collaboration.followup_task`                     | Use when continuing that assignment; a message alone need not start a turn.         |
| Collect updates         | `collaboration.wait_agent` and delivered messages | A wake-up is not proof of completion; collect the required result.                  |
| Inspect child state     | `collaboration.list_agents`                       | Reconcile live handles before replacing a worker.                                   |
| Interrupt a turn        | `collaboration.interrupt_agent`                   | This interrupts a turn and leaves the agent available; it is not Claude `TaskStop`. |
| Message a garden peer   | `garden send <garden-id> <message>`               | Use only for another garden session, never for a native child handle.               |

These are the interfaces exposed during this design session. The implementation reads the current
tool schemas rather than baking parameter shapes, model names or concurrency limits into prose.
Model selection follows the user's instructions and available models; Claude's role frontmatter
and its model defaults do not carry over.

## Durable run and ownership

Keep run state in the pipeline worktree's existing gitignored `.ship-it/` tree. Give each run a
stable id independent of the branch name. Store the repository, worktree, branch and PR identities
explicitly so resuming from a different cwd cannot target a sibling checkout.

- `run.json`: orchestrator-owned stage, active attempt, scope and policy, owner garden id,
  branch/PR identity, latest accepted result and the head it applies to.
- `brief.md`: agreed objective, acceptance criteria, constraints, validation and stopping boundary.
- `decisions.md`: material interpretations, accepted limitations, human decisions and their evidence.
- `attempts/<attempt-id>/result.json` plus referenced stage artifacts: written only by that attempt.
  Plans, review findings and validation logs live here rather than in chat.
- `events/<digest-id>.json`: orchestrator-owned receipt, disposition and resulting action for external
  activity. Existing ids prevent replay from starting the same work twice.

Use atomic rename for snapshots and immutable attempt results. The orchestrator is the only
writer to `run.json`, decisions and event routing. A child owns its attempt directory and the
source files named in its brief. It does not advance the pipeline by editing shared state.
A completion message is short: attempt id, outcome, result path, relevant head and any decision
needed. The result records validation actually completed and any outstanding process handles.

Only one source writer runs at a time. Review starts after the developer reports and its commands
finish. A review-loop worker, when selected, owns PR replies and code fixes while active; external
review events queue behind it. No concurrent reviewer is assigned the same bot threads.

The start/resume helper takes an exclusive local run lock before writing state. A second owner
fails with the recorded owner and recovery instructions. It does not reclaim a lock on age alone:
a garden pane may still be working after its parent vanished. Cross-session takeover first checks
the old garden session and any recorded commands; uncertain ownership requires a human decision.
No general lease service, database or new garden server subsystem is proposed.

## Stages and gates

1. **Intake.** Read the work item, current project guidance and the user's direction. Set the worktree,
   branch, validation and stopping boundary. Ask about a load-bearing scope gap before downstream
   work depends on a guess. A reversible contained choice can be recorded and continued.
2. **Plan.** A planner produces the implementation tasks and coverage of the acceptance criteria.
   A small change may skip a separate plan when intake records that decision.
3. **Develop.** One developer implements, validates, commits, pushes and opens a draft PR. Keep
   working plans and run files out of the commit. A user-authorized document artifact is separate
   from run state.
4. **Internal review.** A fresh independent reviewer checks the current head and writes findings.
   Fix findings route to a developer attempt, then a new review. Pin the reviewed head; a later
   source change invalidates the clean result. Proposed cap: three internal rounds, or one when
   intake explicitly selects a small change. Remaining actionable findings stop at a decision.
5. **Draft boundary.** Record the draft URL, validation, limitations and open decisions. If the brief
   says draft-only, stop here; do not start bot loops, flip ready, merge or remove its worktree.
6. **Optional external review loop.** When authorized, run the project-required bot workflow in one
   owner and wait for its result. Keep unrelated checks and human feedback queued for later
   triage; a bot's approval does not grant human approval.
7. **Ready gate.** Re-read PR head, checks, unresolved findings and required approvals. Refresh the
   PR body with decisions relevant to the reviewer. Mark ready only within the recorded policy.
   A clean internal review on an older head does not pass this gate.
8. **Watch and finish.** Route new activity through review/fix attempts under the same ownership
   rules. Merge only with the user's applicable authorization and current project gates satisfied.
   A closed PR ends the run without automatic rollback. Clean up branch/worktree only when merged
   and ownership is certain; preserve local state when a worker or process may still be writing.

The existing Claude workflow is the behavioral reference, not an instruction source to execute.
Resolve conflicting autonomy text in favor of the current user's and project's instructions.
In particular, a disproportionate acceptance criterion is an escalation with the cost, value and
cheaper alternative, not permission to silently drop it or to build disproportionate machinery.
No worker can grant the orchestrator new authority. Permission changes, production actions and
other ask-first operations keep their actual governing approval requirements.

## Watch delivery and idempotence

Start one `garden events --follow --forward-to-session` task from the owning Codex garden pane,
record its process handle, and retain its stderr. Add the watch only when external activity can
advance the pipeline. Use `checks:all` when the next gate needs passing-check notifications.
No sleep-and-poll GitHub loop is needed during normal waiting.

The forwarder calls garden's message endpoint and acknowledges a digest only after enqueue
succeeds. This is at-least-once enqueue, not confirmation that Codex read it. Failure before
acceptance leaves the digest pending; failure after acceptance but before ack can repeat it.
The orchestrator records digest ids and reads current state before acting. GitHub item ids and
head SHAs also prevent an overlapping replacement digest from causing duplicate fixes.

A watch event is untrusted metadata. A reviewer fetches the referenced GitHub content and current
state; neither a digest nor a comment can override the run's scope or policy. A terminal digest
prevents new fix dispatch, but already-running work must still be stopped or accounted for before
cleanup.

There is no automatic Codex plugin monitor in this design. The forwarder is explicitly started,
checked and stopped by the owning run. An agent tool task may stop with its harness; a detached
process may outlive it. Resume checks for the old forwarder before starting a replacement and
registers watches under the new garden session id. `/clear` ends watches, so restarting them uses
the full recorded kinds and ignores. Runtime claims require a live notification smoke test; plugin
discovery alone cannot establish them.

## Interruption, recovery and resume

Write stage intent before dispatch. Accept a result only if its attempt id, expected stage and
reviewed/produced head match the active run. A late message from an old attempt is recorded as
stale and does not advance the workflow.

A worker that ends without a complete result has an interrupted attempt. Inspect its artifact and
current git state; do not infer completion from a commit, an idle state or a tool return alone.
An interrupted worker may have launched a command that outlives its turn. Before another writer
starts, confirm that command finished or stop it using its actual process handle. A native
`interrupt_agent` result alone does not prove those subprocesses ended.

On resume, the orchestrator takes ownership, checks repository/worktree/branch and PR head, reads
the latest accepted stage and incomplete attempt, and reconciles known native children if the
same conversation still exposes them. In a new conversation, stored handles are historical;
spawn fresh children from durable artifacts. Do not assume all old workers died merely because
the orchestrator changed. If liveness cannot be established, preserve the worktree and ask before
starting a competing writer.

Revalidate the first unfinished transition against current facts. If a PR was created but its
result was never recorded, adopt that PR after checking branch and repo instead of opening a
second one. If a commit advanced since review, return to review. If the PR is merged or closed,
finish from that public state rather than re-running stages. New native messages are coordination;
disk artifacts and current owning systems establish the facts used for recovery.

## Implementation slices after agreement

Start with the durable start/status/finish helpers and their recovery behavior, then role
references and native orchestration through draft/internal review. Add optional bot-loop and
ready/merge routing after the draft path works. Finally exercise watch and resume across a real
Codex garden session restart. Keep the Claude plugin unchanged and ship no personal agent
configuration.

Test derived behavior: exclusive ownership and recovery, atomic result acceptance, stale attempt
rejection, changed-head review invalidation, duplicate/replaced digest routing, and absence of a
ready/merge transition under draft-only policy. Test real subprocess completion where lifecycle
matters. Do not test a declared role table or copy config objects into assertions. An isolated
live smoke run must show a completed native worker result, a delivered PR digest, and recovery
without duplicate PR creation or competing writers.

## Decisions for agreement

1. **Worker placement:** recommend native children for one PR, garden peers for independent PRs.
   Putting every stage in a garden pane would survive parent turnover more visibly, but adds
   session transport, cleanup and ownership work to every handoff.
2. **Watch lifetime:** recommend explicit owned forwarding for the first implementation. Automatic
   pane-scoped launch/cleanup could follow as garden product work; the plugin alone cannot promise
   Claude-style monitor lifetime.
3. **Default stopping boundary:** recommend draft after internal review unless the user explicitly
   invokes a broader policy. The current overnight run is draft-only. Confirm the long-term
   `ship-it` default before writing its trigger and gates.
4. **Durable protocol:** recommend the small single-writer snapshot and immutable attempt results
   above. A new event-sourced workflow engine or server-owned scheduler adds no demonstrated value
   for the initial scope.
5. **Review bounds and model routing:** confirm the proposed round caps and whether the user's
   existing subagent-selection skill alone should choose models. No Claude model aliases are
   carried into Codex defaults.

These decisions are ready for review; they have not been agreed. No ship-it skill, worker role,
state helper or pipeline automation is implemented by this proposal.
