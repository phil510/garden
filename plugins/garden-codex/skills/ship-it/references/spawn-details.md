# Spawn details

Each worker reads `${SKILLDIR}/references/roles/ship-it-<role>.md` and
`${SKILLDIR}/references/worker-protocol.md` in its own fresh context. The orchestrator passes
paths, literal inputs and ownership, never copies role prompts into `.ship-it` or loads their
full contents into its routing context.

## Spawn shape

Use the native operation map below with a self-contained brief and fresh context. Keep a unique
role name in the local ledger; send a task-name argument only when the exposed schema supports it.
Validate its value too: for V2, map the local `review-loop` label to `review_loop` (then
`review_loop2`), because task names accept lowercase letters, digits and underscores. Store that
tool name beside the local label and returned handle. Use a generic available agent type;
bundled Markdown prompts do not register native roles. Supply applicable project instructions,
absolute paths, role/mode/round, and a read-first pointer to the role prompt. Tell workers they
share the filesystem, must preserve others' edits and own only their assigned files.

Choose an exposed Luna model for easy bounded tasks and an exposed Sol model for planning,
implementation or substantive review. Model identifiers and context options come from the current
tool schema, not Claude frontmatter. If overrides are unavailable, inherit the current model.
Respect current agent concurrency and nesting limits: run independent readers in batches when
slots are scarce, and collect every required result before advancing.

The returned handle, not the display name, is the worker's identity. Store it in the ledger.

## Native operations

Choose the column matching the tools actually exposed in this session, not the CLI version or
model name. Native interfaces can differ within the same release. Use the current schema for
argument names and supported model/agent-type overrides; omit unsupported fields. These are
operation mappings, not wrappers to implement or reasons to change feature flags or settings.

| Operation                      | V1 interface (`send_input`, `close_agent`)                                                                     | V2 interface (`followup_task`, `interrupt_agent`)                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Fresh worker                   | `spawn_agent` with `message` and `fork_context: false`; keep the role name locally                             | `spawn_agent` with `message`, unique `task_name`, and `fork_turns: "none"`         |
| Worker report                  | Return the typed report as the turn’s final result; parent collects it through native completion/wait          | `send_message` to the known parent, then end the turn without repeating the report |
| Decision/digest to idle owner  | `send_input` to its returned handle starts the next turn                                                       | `followup_task` to its returned handle wakes it                                    |
| Information during active work | No passive-message equivalent: `send_input` submits input; use it only when the work should receive that input | `send_message` delivers information without starting an idle turn                  |
| Wait/inspect                   | `wait_agent` with the handles required by its schema                                                           | `wait_agent` for updates; `list_agents` for status when exposed                    |
| Stop/retire                    | `close_agent` on the owned handle; inspect the result                                                          | `interrupt_agent` if active, inspect status, then retire the handle in the ledger  |

A completed **turn** is not a completed **stage**. `ESCALATING`, `triggered` and loop waiting
reports leave that same worker owning the stage; keep it idle and wake it with the follow-up
operation. Only a done report or explicit replacement retires it. V1 `resume_agent` can reopen a
closed agent, but this pipeline never reopens a retired writer; recovery uses live owners or a
fresh replacement after the stop barrier. Do not assume a parent alias or send input to an unknown
recipient. On V1 the natural return channel supplies worker reports without such an assumption.

## Naming and the live-worker ledger

The orchestrator keeps a **live-worker ledger** in its own context (Contract § Ownership): per
role, the live worker's name, its state — working, waiting on an escalation, or reported — and the
next counter. It lasts for the current runtime. Compaction does not retire handles: inspect native status and
recover the ledger before dispatching. In a fresh runtime, reconcile prior writers and owned
commands first; only then start an empty ledger and counters at 1.

- **Counter per role, incremented on every spawn, decoupled from the round tag.** `developer1` is
  the stage-2 initial developer, `developer2` the first fix round whatever review it addresses,
  and so on; the round number lives in the opener. `reviewer1`, `reviewer2`, … one per spawn — per
  internal round and per digest, interleaved, always the next integer. An escalation answered in
  place keeps the worker's name; only the fresh-spawn fallback takes a new one.
- **Never reuse a name.** A fresh spawn always takes the next counter value, so a name always means
  one worker.
- **The review loop is a singleton**, named `review-loop`, woken with the native follow-up operation. Spawn
  `review-loop2` only to replace one you have stopped.
- **A worker that reported done is finished.** The orchestrator never messages it again — its
  successor may already hold the pen — and stops it (§ Stopping a worker).
- **A worker waiting on an escalation is not finished.** It still holds the pen and is the
  decision's target: message it under its own name, and never stop it while the decision is
  pending.

### Wake, don't duplicate

Before any fresh spawn of a role, consult the ledger. If a worker of that role is live — waiting on
an escalation, or the review loop between rounds — **wake it with the native follow-up operation; don't spawn a
second one beside it.** Waking a live worker is the intended way to hand it a decision or a digest.
The defect to avoid is two workers of one role alive at once, both believing they hold the pen.

A woken worker that doesn't answer — an idle notification with no report — is silent, not gone. It
may still write, so page the user rather than spawning a replacement beside it. A fresh spawn is
right only when the ledger shows no live worker of that role: the previous one reported done and
was retired after confirming its commands stopped. A terminal agent status or a fresh runtime
still requires that process check.

### Thin opener

About five lines, carrying only what the role prompt can't know:

- the stage, round, or mode tag (`stage 2 initial`, `fix-round 2`, `external classification`);
- the values for the variables the Contract's opener table lists for the role — absolute paths
  spelled out in full, since there is no `envsubst`, no shell export, and no expansion at spawn;
- for dual-mode roles, the mode: _"You are in `fix-round` mode — follow that section."_ Mode
  sections are the only branching primitive in the role prompts.

Example (developer fix-round on an internal review file):

```
You are the developer for feat/foo, in fix-round mode, round 2.
${SKILLDIR}    = /abs/path/to/plugin/skills/ship-it
${WORKTREE}    = /abs/path/to/worktree
${SHIPITDIR}   = /abs/path/to/worktree/.ship-it/feat/foo
${WORKFLOW}    = /abs/path/to/worktree/.ship-it/feat/foo/workflow.md
${REVIEW_FILE} = /abs/path/to/worktree/.ship-it/feat/foo/review-round-2.md
${PR_URL}      = https://github.com/org/repo/pull/123

You are in fix-round mode — follow that section. Apply every fix finding in ${REVIEW_FILE}.
Substitute the values above wherever your instructions reference ${VAR}.
```

A fresh-spawn fallback for an escalation adds the decision block (`communication.md` § #3) and:
_"Apply the decision and complete your stage per your agent instructions. Reconstruct state from
${WORKFLOW} and the escalation event file."_

## Worker lifecycle

Stages 1–3 run strictly sequentially. For each:

1. Spawn through the exposed native operation, label the ledger entry with the next-numbered
   role name, and retain the returned handle.
2. The worker does its stage, finishes its disk writes, then sends its report (`communication.md`
   § #2).
3. The orchestrator routes off the report, then stops the reporter (§ Stopping a worker).
4. The orchestrator spawns the next worker. An escalation pauses the stage at step 2 instead: the
   decision goes back to the same worker, which then finishes and reports.

**Single-writer-per-moment comes from sequential dispatch**, backed by stopping each worker once it
reports. Only one worker holds a write pen at a time; an escalating worker keeps its pen through
the pause because nothing else runs until it reports.

**Fresh-spawn-per-round is the default**, not an optimization — a fresh native subagent reading the diff
and `plan.md` cold has clean context, which is the point. The one exception is an escalation, where
the decision goes back to the waiting worker; when that worker is gone, idempotent instructions (§
Why this shape) make a fresh spawn behave the same — except for `review_cap`, which the
orchestrator carries out itself.

The review-loop worker is the long-lived exception. It **does** write — through the loop skill it
pushes commits and posts PR replies — but single-writer still holds: it starts only after stages
1–3 have reported, and until it reports `done` the orchestrator hands digests to it rather than
spawning a reviewer. It never writes `workflow.md` or stage artifacts; its durable state is the
loop skill's own files under `${WORKTREE}`, `review-loop-state.json`, and `review-loop.log`.

## Stopping a worker

Retirement means this pipeline will never dispatch to the handle again. On a done report,
confirm the worker ended its turn and its owned commands completed. Close it when the native
interface provides close; otherwise mark the completed handle retired. For an active worker,
use the map’s stop operation and inspect the result/status before marking it retired. V1 close
and V2 interruption differ; neither proves shell process cleanup. A stop message alone is not
confirmation. Do not resume or wake a retired handle after a successor owns the work.

Before another writer starts or the worktree is removed, confirm every owned shell process is
stopped, including descendants or detached services. Track process/session handles as commands
start, collect completion through the shell continuation tool, and stop still-running owned work
through that tool or its recorded process identity. Interrupting an agent does not prove its
commands stopped. If identity or termination is uncertain, keep the worktree and branch and do not
dispatch a replacement writer; report the unresolved ownership to the user.

Apply the barrier on done, loop completion, replacement, abort and finish. A worker awaiting an
escalation is still the owner: wake it with the native follow-up operation, do not retire or duplicate it.

## Permission mode

Use the session's existing approvals and sandbox. Starting the pipeline does not authorize
changing permission settings or bypassing prompts. Spawn without an extra permission-mode
question; report an actual approval block through the harness when encountered.

## Process waits

Run long checks and backstops with the shell tool's bounded initial yield and retain its process
handle. Use its continuation/wait operation until completion, staying responsive to native worker
messages and Garden digests between waits. Do not treat a yielded tool call as completion or
expect a Claude background-job notification. Record each wait's head or trigger timestamp so
superseded results cannot advance the pipeline. Use the map’s wait operation for worker activity; inspect its
status and report because a notification is not necessarily task completion.

## Why this shape

- **Context economy.** Each role prompt plus the shared `worker-protocol.md` runs to a few
  hundred lines. The worker-reads-its-own-instructions pattern keeps all of it out of orchestrator
  context.
- **Drift control.** One role prompt per role, plus one shared protocol and one Contract. A fix
  in any of them reaches every future spawn without a per-pipeline copy-edit — though a running
  pipeline keeps the plugin copy it started with.
- **Idempotent-instructions parity.** Because the role prompt is stable and a worker
  reconstructs all state from `workflow.md` and the stage artifacts, a fresh spawn mid-pipeline —
  after a death, or as the escalation fallback — behaves the same as the original would have.

The only files in `.ship-it/<branch>/` are the brief and stage artifacts; the orchestrator never
writes per-role instruction files there.
