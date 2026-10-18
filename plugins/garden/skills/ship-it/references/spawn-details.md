# Spawn details

Each worker role is an agent definition shipped in this plugin, spawned as
`garden:ship-it-<role>` (Contract § Names). Its body opens by reading
`${SKILLDIR}/references/worker-protocol.md`, then its own role content. The orchestrator does
**not** copy either into `.ship-it/<branch>/` and does **not** rewrite them per pipeline.

Every worker is spawned via the `Agent` tool as a teammate of the pipeline team, and **reads its
own agent definition and `worker-protocol.md` in its own context.** The orchestrator hands it a
thin opener; that content never enters orchestrator context. **You never read worker agent
definitions or `worker-protocol.md` yourself** — peeking at one is several thousand tokens of leak
for information the worker already has.

## Spawn shape

The team forms implicitly on the first named spawn — there is no `TeamCreate` step. Then per
worker:

```
Agent(
  name:          <role><n>,                 # e.g. developer2; review-loop for the singleton
  subagent_type: garden:ship-it-<role>,     # e.g. garden:ship-it-developer
  model:         <omit, or override>,       # omit to use the agent's frontmatter default
  prompt:        <thin opener>,
)
```

The role lives in the agent type, not the opener; the opener's "You are the <role> for …" line is a
restatement for the worker's benefit, not the routing mechanism. The bare `ship-it-<role>` form is
wrong here: a plugin's agents resolve only under the plugin's namespace, and a bare name can match
a personal agent of the same name instead.

- **Model.** Each agent's frontmatter declares its default — `opus` for the planner, `sonnet` for
  the rest — so a normal spawn omits `model:`. The planner gets opus because planning is where
  judgment pays off and it is a small share of a run's spend; the developer stages, where most of
  the spend goes, get sonnet because ship-it targets small and medium PRs. Override on your own
  reading of the task, not only when the user asks: `opus` for a developer or reviewer facing dense
  logic, concurrency, or security-relevant paths; `sonnet` for a planner on a brief with nothing
  left to decide. The `model` param takes precedence over the frontmatter.
- **`name`** addresses the worker for `SendMessage` and `TaskStop`. This is the orchestrator
  naming _its_ teammates; workers fan out to anonymous `Explore` and review subagents, which need
  no name.

## Naming and the live-worker ledger

The orchestrator keeps a **live-worker ledger** in its own context (Contract § Ownership): per
role, the live worker's name, its state — working, waiting on an escalation, or reported — and the
next counter. It lasts for the current session only, because teammates don't outlive the
orchestrator's session; on `/garden:ship-it resume` in a new session nothing is live and every
counter restarts at 1.

- **Counter per role, incremented on every spawn, decoupled from the round tag.** `developer1` is
  the stage-2 initial developer, `developer2` the first fix round whatever review it addresses,
  and so on; the round number lives in the opener. `reviewer1`, `reviewer2`, … one per spawn — per
  internal round and per digest, interleaved, always the next integer. An escalation answered in
  place keeps the worker's name; only the fresh-spawn fallback takes a new one.
- **Never reuse a name.** A fresh spawn always takes the next counter value, so a name always means
  one worker.
- **The review loop is a singleton**, named `review-loop`, woken with `SendMessage`. Spawn
  `review-loop2` only to replace one you have stopped.
- **A worker that reported done is finished.** The orchestrator never messages it again — its
  successor may already hold the pen — and stops it (§ Stopping a worker).
- **A worker waiting on an escalation is not finished.** It still holds the pen and is the
  decision's target: message it under its own name, and never stop it while the decision is
  pending.

### Wake, don't duplicate

Before any fresh spawn of a role, consult the ledger. If a worker of that role is live — waiting on
an escalation, or the review loop between rounds — **wake it with `SendMessage`; don't spawn a
second one beside it.** Waking a live worker is the intended way to hand it a decision or a digest.
The defect to avoid is two workers of one role alive at once, both believing they hold the pen.

A woken worker that doesn't answer — an idle notification with no report — is silent, not gone. It
may still write, so page the user rather than spawning a replacement beside it. A fresh spawn is
right only when the ledger shows no live worker of that role: the previous one reported done and
was stopped, it `teammate-terminated`, or this is a new session.

### Thin opener

About five lines, carrying only what the agent definition can't know:

- the stage, round, or mode tag (`stage 2 initial`, `fix-round 2`, `external classification`);
- the values for the variables the Contract's opener table lists for the role — absolute paths
  spelled out in full, since there is no `envsubst`, no shell export, and no expansion at spawn;
- for dual-mode roles, the mode: _"You are in `fix-round` mode — follow that section."_ Mode
  sections are the only branching primitive in the agent definitions.

Example (developer fix-round on an internal review file):

```
You are the developer for feat/foo, in fix-round mode, round 2.
${SKILLDIR}    = /abs/path/to/plugin/skills/ship-it
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

1. Spawn via `Agent` under the next-numbered name.
2. The worker does its stage, finishes its disk writes, then sends its report (`communication.md`
   § #2).
3. The orchestrator routes off the report, then stops the reporter (§ Stopping a worker).
4. The orchestrator spawns the next worker. An escalation pauses the stage at step 2 instead: the
   decision goes back to the same worker, which then finishes and reports.

**Single-writer-per-moment comes from sequential dispatch**, backed by stopping each worker once it
reports. Only one worker holds a write pen at a time; an escalating worker keeps its pen through
the pause because nothing else runs until it reports.

**Fresh-spawn-per-round is the default**, not an optimization — a fresh teammate reading the diff
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

**`TaskStop <name>` is the stop.** It ends a named background agent or teammate by name. A
`shutdown_request` message is at most a courtesy before it — its handshake doesn't reliably
complete, so it never counts as having stopped anything.

Stop a worker when it has reported done, when the review loop reports `done`, when replacing a
misbehaving worker, and at finish for every worker still in the ledger. Never stop a worker that is
waiting on an escalation decision you still intend to send.

A worker is **confirmed stopped** when `TaskStop` succeeded, or when it reported that the agent is
not running. Any other result — an error, a timeout, an unrecognised name for a worker the ledger
says is live — means termination is **uncertain**. Record it in the ledger as uncertain; at finish,
an uncertain worker keeps the worktree and branch in place, since a worker that may still be
running would be writing into a directory that no longer exists.

## Permission mode

**The pipeline session needs the autonomy to run unattended — auto mode normally suffices,
`bypassPermissions` removes the remaining stalls — and every worker inherits it.** `Agent`-spawned
teammates run under the parent session's permission mode, and a per-spawn `mode` does not reliably
tighten or loosen it. The lever is the session, set once at launch — not the spawn.

Why this much autonomy: ship-it runs hands-off for hours with nobody attached. Anything that
prompts — a Bash permission wall, an edit confirmation, an MCP approval — stalls a worker the moment
it hits the gate, with no escalation, no message, no signal that anything is wrong. `acceptEdits`
is insufficient: it still gates Bash, and workers run git, gh and the project's toolchain
constantly.

Either mode is safe because the real boundaries live where a worker can't cross them: the brief's
§5 Autonomy bounds, draft-PR isolation, and worktree confinement. For an unattended pipeline, a UI
gate that fails silently is worse than none.

Nothing lets a session read its own permission mode reliably, so **assume the session was launched
with the autonomy the pipeline needs** and spawn without asking. Whoever runs `/garden:ship-it` is
deliberately starting an unattended pipeline; they know the precondition and will say so when it
doesn't hold.

## Why this shape

- **Context economy.** Each agent definition plus the shared `worker-protocol.md` runs to a few
  hundred lines. The worker-reads-its-own-instructions pattern keeps all of it out of orchestrator
  context.
- **Drift control.** One agent definition per role, plus one shared protocol and one Contract. A fix
  in any of them reaches every future spawn without a per-pipeline copy-edit — though a running
  pipeline keeps the plugin copy it started with.
- **Idempotent-instructions parity.** Because the agent definition is stable and a worker
  reconstructs all state from `workflow.md` and the stage artifacts, a fresh spawn mid-pipeline —
  after a death, or as the escalation fallback — behaves the same as the original would have.

The only files in `.ship-it/<branch>/` are the brief and stage artifacts; the orchestrator never
writes per-role instruction files there.
