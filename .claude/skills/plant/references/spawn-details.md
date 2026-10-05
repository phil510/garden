# Spawn details

Each worker role is a named agent definition at
`.claude/agents/plant-{planner,developer,reviewer}.md`. Its body opens by
reading `.claude/skills/plant/references/worker-protocol.md` (the shared
worker rules), then its own role content. The orchestrator does **not**
copy either into `.plant/<branch>/` and does **not** rewrite them per
pipeline. They are stable, with `${VAR}` placeholders.

Every worker is spawned via the `Agent` tool as a teammate of the
pipeline team, and **reads its own agent definition and
`worker-protocol.md` in its own context.** The orchestrator hands it a
thin opener with the paths; that content never enters orchestrator
context.

**You never Read worker agent definitions or `worker-protocol.md`
yourself.** Peeking at one to "check what it says" is 4–8K tokens of
leak for information the worker already has. The opener carries
everything the orchestrator needs to know about the spawn; the rest is
the worker's concern.

## Spawn shape (all workers)

The team forms implicitly on the first named spawn — there is no
`TeamCreate` step (on resume within the same session, reuse the
already-active team). Then per worker:

```
Agent(
  name:          <role><n>,             # unique per spawn, e.g. developer2
  subagent_type: plant-<role>,          # one per role, e.g. plant-developer
  model:         <omit, or override>,   # omit to use the agent's frontmatter default
  prompt:        <thin opener>,
)
```

Each role spawns with its own `subagent_type: plant-<role>` —
`plant-planner`, `plant-developer`, `plant-reviewer` — and that agent's
definition is the worker's complete instruction set. The role lives in
the agent type, not in the opener; the opener's "You are the <role>
for..." line is a restatement for the worker's benefit, not the routing
mechanism.

- **Model.** Each role's agent definition declares its default in
  frontmatter — `opus` for the planner, `sonnet` for the developer and
  reviewer — so the orchestrator doesn't pass `model:` on a normal
  spawn. The planner gets opus because planning is where judgment pays
  off and it is a small share of a run's spend; the developer stages,
  where most of the spend goes, get sonnet because `plant` targets
  small/medium PRs where its capability is enough. Override any stage on
  your own reading of the task's complexity, not only when the user
  asks: `model: opus` for a developer or reviewer facing dense logic,
  concurrency, or security-relevant paths; `model: sonnet` for the
  planner on a brief with nothing left to decide. The Agent tool's
  `model` param takes precedence over the frontmatter.
- **`name`** is the role string plus a per-role counter (`planner1`,
  `developer2`, `reviewer1`). It's how the orchestrator addresses the
  worker with `SendMessage`. **Never reuse a name** — each fresh spawn of
  a role takes the next counter value; the orchestrator tracks the
  current live name + next counter per role in workflow state (see §
  Naming). (This is the orchestrator naming _its_ teammates — distinct
  from the in-process `name` param a teammate cannot pass to _its own_
  fan-out children. Workers fan out to anonymous `Explore` / persona
  subagents, which need no `name`.)

## Naming

Idle teammates can't be reliably killed — a `shutdown_request` handshake
doesn't reliably complete, so a "shut down" worker lingers idle-alive
until the session ends with `/exit`. So once a worker has reported its
stage _done_, the orchestrator **treats it as dead** and gives every
fresh spawn of a role a unique numbered name:

- **Counter per role, incremented on EACH spawn — decoupled from the
  round tag.** Do _not_ equate `developerN` with `review-round-N`: the
  round tag (`fix-round mode, round 2`) lives in the opener and is
  separate from the routing name. `planner1` (normally spawned once;
  increments only if fresh-spawned as the escalation fallback). `developer1` = the
  stage-2 initial dev, `developer2` = the first fix round (whatever
  review it addresses), `developer3` = the second fix round, etc.
  `reviewer1`, `reviewer2`, … one per spawn, always taking the next
  integer.
- **Never reuse a name.** A fresh spawn always takes the next counter
  value. This removes the routing ambiguity that same-name re-spawns
  would create — a live worker and one or more idle zombies sharing a
  name.
- **A worker that reported its stage done is finished.** Once it reports and
  idles, the orchestrator never messages it again: its successor may
  already hold the pen, and a message would wake a second writer. It MAY
  send `shutdown_request` as best-effort cleanup but does not depend on
  it — the idle teammate harmlessly lingers (holds no pen, writes
  nothing) until `/exit`.
- **The exception is a worker waiting on an escalation.** It has not
  finished, nothing else was dispatched, and it still holds the pen, so
  messaging it under its own name keeps it the only writer. It is the
  decision's target, never a `shutdown_request` target — a shutdown
  would end the one worker that can continue in place.
- **The orchestrator tracks the current live worker name + the next
  counter per role** in `workflow.md` / pipeline state, so `SendMessage`
  targets the right teammate (including an escalator awaiting its
  decision) and a resume re-enters with the right counter. On a resume _within the same session_, continue the counters;
  after `/exit` the old team is gone, so a fresh session may restart at 1.
- **Residue:** idle `developerN` teammates accumulate, bounded by round
  count, harmless, cleared on `/exit`.

### Thin opener

~5 lines, carrying only what the agent definition can't be written to
know:

- the stage / round / mode tag (`stage 2 initial`, `fix-round 2`);
- the worker's env — branch, **absolute** paths (`${PLANTDIR}`,
  `${WORKFLOW}`), PR URL, and any input findings file
  (`${REVIEW_FILE}`);
- the values to substitute wherever the worker's instructions reference
  `${VAR}` — no separate "read your brief" line, since `subagent_type`
  already selected the role's instruction set.

Paths are passed as literal absolute strings in the opener — there is no
`envsubst`, no shell `export`, no `${VAR}` expansion at spawn. The
worker does the substitution mentally as it reads its instructions.
This is why the opener must spell the paths out in full rather than
relying on the worker's environment.

For dual-mode roles (developer, reviewer), the opener names the mode:
_"You are in `fix-round` mode — follow that section."_ Instructions carry
no conditional logic; mode-sections are the only branching primitive.

Example (developer fix-round on an internal review file):

```
You are the developer for feat/foo, in fix-round mode, round 2.
${PLANTDIR}    = /path/to/worktrees/feat/foo/.plant/feat/foo
${WORKFLOW}    = .../workflow.md
${REVIEW_FILE} = .../review-round-2.md
${PR_URL}      = https://github.com/org/repo/pull/123

You are in fix-round mode — follow that section. Apply every fix finding
in ${REVIEW_FILE}. Substitute the values above wherever your
instructions reference ${VAR}.
```

## Worker lifecycle

Stages 1–3 run strictly sequentially. For each:

1. Spawn via `Agent` under the next-numbered name (§ Naming).
2. Worker does its stage, finishes its disk writes (atomic rename), then
   sends its typed `SendMessage` (§ Messages, below).
3. Orchestrator routes off the message.
4. Worker self-idles; once it has reported its stage done, the
   orchestrator spawns the next worker under the next counter value,
   treating the prior as dead (§ Naming).

**Single-writer-per-moment comes from self-idle + sequential dispatch,
not from a kill.** Each worker idles itself after reporting, and the
orchestrator spawns the next only after the prior has reported — so only
one ever holds a write pen. An escalation pause extends this: the
escalator idles _waiting_ and keeps the pen, nothing else is dispatched
until it has its decision and reports. Idle workers _do_ coexist (they
linger until `/exit`), but a worker that reported done holds no pen and
writes nothing, so they don't race. A `shutdown_request` is not what prevents the race —
its handshake doesn't reliably complete, so it's best-effort cleanup at
most.

**Fresh-spawn-per-round is the default**, not an optimization — a fresh
teammate reading the diff + `plan.md` cold has clean context, which is
the point. Round workers are fresh per round. An escalation decision is
messaged back to the waiting escalator, which continues with its
context; fresh-spawn is the fallback for when that worker is gone, and
idempotent briefs (§ Why this shape) make it behave the same as the
in-place continuation.

**Retry / replace.** To retry a failed spawn, just re-dispatch `Agent`
under the next counter value — there is no UUID to relock, no dead
session to evict. For the normal next-round case that's all there is:
spawn the next-numbered worker, leave the prior idle. To replace a
_misbehaving_ (non-idle) worker there is no clean in-place swap — the
`shutdown_request` handshake won't fire on a runaway. The honest options
are a corrective `SendMessage` (if it's cooperative) or,
if it's genuinely dangerous, `/exit` the session; you cannot guarantee
killing a runaway mid-session.

## Messages and disk

Filesystem artifacts (`workflow.md`, `plan.md`, `review-round-<k>.md`,
`events/<iso>-escalation.md`) are the durable record: workers write
them, the orchestrator reads them (and writes annotations + brief
edits), every write is an atomic rename.

**Single-writer-per-moment.** The orchestrator is the sole dispatcher,
and only one worker holds a write pen at any time — enforced by each
worker self-idling after it reports (an escalator self-idles _waiting_
and is messaged back, still the only writer), plus strictly sequential
dispatch. The orchestrator gives each fresh worker a unique numbered
name and treats a worker that reported done as dead; it does not rely
on `shutdown_request` to serialize (that handshake is unreliable).

Every worker reports with a typed `SendMessage`. There is no exit code
and no stdout file — the message body **is** the signal. This is the
context-economy core of the pipeline: the orchestrator routes off the
message and reads disk only on-demand, instead of reading `workflow.md`
and `events/` on every hop to reconstruct what a subprocess did.

**The protocol:**

1. **Write-then-signal.** The worker finishes its disk writes (atomic
   rename), _then_ sends its message. Disk is consistent before the
   orchestrator can act on the signal.
2. **The message carries the routing summary** — enough for the
   orchestrator to pick the next dispatch without reading disk:
   - Planner: `stage 1 done — plan.md written, N tasks, coverage table complete`
   - Developer (initial): `stage 2 done — draft PR <url>, commits <shas>`
   - Reviewer: `round K clean — PR remains draft` _or_ `round K dirty — M fix findings in review-round-K.md`
   - Any worker: `ESCALATING — see events/<iso>-escalation.md, decision needed on <X>`
   - Orchestrator to a waiting escalator: the decision block plus a
     pointer to the event file (§ Messaging the decision)
3. **The orchestrator routes off the message.** It reads disk only when
   (a) it needs detail it chose not to inline, or (b) a high-stakes hop
   warrants verification — the finish gate, pipeline completion, or a
   contradictory signal.
4. **Detail goes to the consumer, not through the orchestrator.**
   Per-finding dispositions live in the review file; the _next worker_
   (a fresh developer fix-round) reads that file. The orchestrator only
   needs the counts to choose the next dispatch.
5. **Disk remains the resume source.** Messages are ephemeral. A fresh
   orchestrator after session death, or a fresh worker, rebuilds entirely
   from disk. The message is a fast-path summary _of_ disk state, never a
   substitute for it.

**Why this doesn't violate "verify before trust."** Trusting a worker's
report of _its own just-completed actions_ is a low-risk class — the
worker knows what it did, and consequences surface downstream anyway.
That is distinct from trusting an agent's claims about code behavior or
types, which the workers still verify. The high-stakes hops (paging the
user, completing the pipeline) still read disk to confirm.

### Crash fallback — bare termination → disk-read

If a worker dies after a disk write but before its message, the
orchestrator sees only the machine `teammate-terminated` notification
with no preceding result message. It then falls back to the old
discipline: read `workflow.md` + `events/` to classify what the worker
completed. The message fast-path is the steady-state optimization;
disk-read is the always-correct fallback that fires on a bare
termination signal.

### Messaging the decision

When a worker escalates, it writes the escalation event, sends its
`ESCALATING` message, and ends its turn _waiting_ — it still holds the
pen. The orchestrator auto-resolves within `autonomy.md`'s bounds or
pages the user, writes the `## Resolution` block and `> RESOLVED`
annotation to disk first (so the decision survives the worker), then
`SendMessage`s the escalator under its current live name. Every
resolution is messaged back, auto-resolves included: an escalator nobody
messages never finishes. The message is the wake-up; the Resolution
block on disk is authoritative. See `escalate-resume.md`.

Message body: the standard decision block below, then _"Read the
Resolution block in `events/<iso>-escalation.md`, apply the decision,
and complete your stage."_ If the resolution edited the brief, the edit
is already on disk and the message adds _"re-read the brief"_ — the live
escalator is never replaced for a brief edit.

```markdown
# Resolution for escalation <iso>

**Decision:** <option from worker's Suggested options, or free-text>
**Rationale:** <optional user clarification>
```

### Fresh-spawn fallback

Only when the escalator is _gone_ — the session is new (`/plant resume`)
or the worker `teammate-terminated` with no result — **fresh-spawn** the
role via `Agent` under the next-numbered name (a `review_cap` decision is
the exception: the orchestrator carries it out itself,
`escalate-resume.md` § Fallback), with the same decision
block in the opener and a pointer to the escalation event file. A worker
that is merely silent after the decision was sent is not gone and is
paged to the user, not replaced (`escalate-resume.md`). Template for
the opener's tail:

```markdown
Apply the decision and complete your stage per your agent instructions.
Reconstruct state from ${WORKFLOW} + the escalation event file.
```

### User dialogue

Only the orchestrator talks to the user. Workers never do.

- **Triage gate.** Artifact clear on what to build → proceed without
  waiting; ambiguous or self-contradictory about what to build → ask
  the user about exactly that, once, then proceed (`brief.md`
  § Stage 0).
- **Escalation pages.** Render the escalation event's one-liner +
  options + artifact pointer; wait for user input; translate the
  response into a decision block messaged back to the escalator (see
  `escalate-resume.md`).
- **Mid-pipeline questions.** Run `scripts/pipeline-status.sh` and render
  a digest from its JSON. Never pull raw worker output into your context.
- **Finish gate.** `Merge policy: ask` → report CI-green status and
  hand the user the merge. `auto` → proceed to squash-merge without a
  page — this is the one irreversible act in the pipeline, so it's the
  one field the user set explicitly for it.
- **Completion summary.** Duration, round count, escalation count,
  `decisions_entries` (a count, not the entries' content), PR URL — all
  returned by `scripts/pipeline-finish.sh`.

## Permission mode

**The pipeline session must run in `bypassPermissions`, and every worker
inherits it.** `Agent`-spawned teammates run under the parent session's
permission mode, and a per-spawn `mode` does not reliably tighten or
loosen it (probed 2026-06-15: a teammate spawned with `mode: default`
still ran Write + Bash ungated under a permissive session). The lever is
the **session**, set once at launch — not the spawn.

Why bypass and not something tighter: `plant` runs hands-off for hours
with nobody attached. Anything that prompts — a Bash permission wall, an
edit confirmation, an MCP approval — stalls a worker the moment it hits
the gate, with no escalation event, no message, no signal that anything
is wrong. `acceptEdits` is insufficient: it still gates Bash, and
workers run git / gh / pnpm constantly. Per-call escalation would be
death by a thousand pages.

That is safe because the real boundaries live where a worker cannot
cross them: the brief's **Autonomy bounds** and **Stop conditions** (see
`brief.md`), draft-PR isolation, and worktree confinement. For an
unattended pipeline, a UI gate that fails open silently is worse than no
gate at all.

No API lets a session read its own permission mode, and nothing in the
environment reveals it reliably — injected instruction blocks that
correlate with a mode describe tool preferences, not the mode, and can
be reworded or dropped without anyone treating it as a contract change,
so a check built on one reads as authoritative while resting on a
coincidence. So **assume the session was launched with the autonomy the
pipeline needs** and spawn without asking. Whoever runs `/plant` is
deliberately starting an unattended multi-hour pipeline; they know the
precondition and will say so when it doesn't hold.

## Why this shape

- **Context economy.** Each agent definition plus the shared
  `worker-protocol.md` runs to a few hundred lines. Inlining them per
  pipeline would cost tens of thousands of orchestrator tokens that buy
  nothing they don't already say. The worker-reads-its-own-instructions
  pattern keeps that content out of orchestrator context entirely.
- **Drift control.** One canonical agent definition per role, plus one
  shared protocol file. A worker fix in `plant-developer.md`, or a
  cross-role fix in `worker-protocol.md`, reaches every future spawn
  without a per-pipeline copy-edit.
- **Idempotent-instructions parity.** Because the agent definition is
  stable and a worker reconstructs all state from `workflow.md` + stage
  artifacts, a fresh spawn mid-pipeline (after a death, or as the
  escalation fallback) behaves the same as the original worker would
  have. This is what makes the fallback safe to take — it behaves like
  the in-place continuation — see `escalate-resume.md`.

The orchestrator never writes `planner.md`, `developer-initial.md`, or
`reviewer-internal.md` into `.plant/<branch>/`. The only files in that
directory are the brief + stage artifacts.
