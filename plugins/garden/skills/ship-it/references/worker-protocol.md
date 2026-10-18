# Ship-it worker protocol

Everything here is true for every ship-it worker. Your own agent definition carries what is
specific to your role; where the two touch the same thing, your role file wins on role-specific
detail and this file wins on the shared mechanics. The names, shapes and values both of them rely
on — agent types, opener variables, the brief's fields, report shapes — are fixed in the Contract
section of `${SKILLDIR}/SKILL.md`.

## How you were spawned

You are a **teammate** of the orchestrator, created via the `Agent` tool with full tool access.
Your opener names your role, your branch, and the paths you work against. Those values arrive
**already substituted** — the opener carries literal values where this file and your role file
write `${SKILLDIR}`, `${SHIPITDIR}`, `${WORKFLOW}`, `${BRANCH}`, `${MODE}`, and the rest. Nothing
preprocesses the text you read, so substitute mentally as you go; there is no `envsubst` step and
you never run one. Each name's meaning is in
`${SKILLDIR}/references/placeholders-and-annotations.md` § Placeholder vocabulary.

You work inside a git worktree, reached by the absolute paths in your opener. Do not `cd` into it
and do not assume a working directory.

The project's conventions — branch and commit format, PR template, verify command, dependency
install and auth, which side effects outside the worktree are allowed — reach you the same way they
reach the orchestrator: through the instructions Claude Code injects into your session. Follow
them; ship-it deliberately carries none of its own beyond the defaults the brief records.

You do not talk to a human. You message only the orchestrator — there are no peer-worker channels.
Everything else you have to "say" lives on disk.

## Idempotency

A stage is entered by a **fresh spawn** — at the start, and as the escalation fallback when the
escalator is gone. A cold start and a fallback replacement are the same code path and must produce
the same outcome. A worker woken by an escalation decision is the exception: it never left, so it
continues from its own context instead of rebuilding (§ Escalation).

Rebuild your state from `${WORKFLOW}` plus the stage artifacts on disk — `${SHIPITDIR}/plan.md`,
`${SHIPITDIR}/decisions.md`, `${SHIPITDIR}/events/`, `review-round-*.md`, and whatever your role
names. Never lean on in-memory continuity from a prior session or a prior turn.

Trust the prior artifacts as written, including any `## Acceptance criteria (derived from spec)`
section a planner wrote into `plan.md`. The one thing that overrides them is a recorded decision: if
you see an `> ESCALATED` annotation followed by `> RESOLVED`, read the named event file in
`${SHIPITDIR}/events/` and its `## Resolution` block. Treat the Decision and Rationale as binding
on the escalated point, and pick up from where the escalation paused rather than redoing settled
work. The user's Decision may be free text rather than one of the suggested options; interpret it
against those options and the brief.

While you are the active stage worker you are the sole writer to `${WORKFLOW}`
(single-writer-per-moment, enforced by the orchestrator's sequential dispatch). This holds through
an escalation pause: while you wait for a decision you still hold the pen, which is why nothing
else is dispatched.

## Resolving your inputs

Read `${WORKFLOW}` in full before anything else. The brief at the top is your source of truth: the
header fields (`Tracker`, `Review loop`, `Spec`, `Size`) and §1–7 — Objective, Scope, Acceptance
criteria, Verify command, Autonomy bounds, Stop conditions, Merge policy. `Review loop` and §7 are
the orchestrator's; other roles don't act on them. Re-read the brief whenever you're about to make
a judgment call — the orchestrator can edit it mid-pipeline, so a stale opener may drift from it.

Three input shapes exist. Identify yours from the header fields:

- **Standard.** §3 holds the ACs, and `${SHIPITDIR}/plan.md` holds the task list.
- **Spec-backed** (`Spec` is a path, §3 absent). The ACs are the planner-derived
  `## Acceptance criteria (derived from spec)` section in `plan.md`. Read the spec in full; its
  architecture and costly-to-reverse decisions are **settled** — do not re-derive them. Something
  that contradicts a settled decision is an escalation (`reason: ambiguity`), not a judgment call.
- **Small** (`Size: small`). There is no `plan.md`. §3's ACs are the task list, and there is no
  coverage table to write or check.

What you do with the ACs and tasks once you have them is role-specific and lives in your agent
definition.

## Write discipline

- **`workflow.md` and `decisions.md` are append-only.** Annotations go at the end of
  `## Annotations`, flat and chronological — never inserted under a stage's checkbox line, never
  indented. The scripts match annotations and decision entries at **column 0**; an indented or
  nested one is silently invisible to status reporting and escalation counting. Never rewrite a
  prior line.
- **Atomic rename for every state-file write.** Write `<file>.tmp`, then `mv <file>.tmp <file>`. A
  mid-write crash then leaves an orphan `.tmp`, not a corrupt artifact.
- **Stage workers (planner, developer, reviewer) flip their checkbox in the same atomic write as
  the final `> NOTE`.** One write changes `- [ ]` → `- [x]` in `## Stages` and appends the note;
  then you signal. The review-loop never writes `workflow.md`.
- The annotation grammar is exactly five kinds — `> NOTE`, `> BLOCKED`, `> STALLED`,
  `> ESCALATED`, `> RESOLVED` — and `> RESOLVED` belongs to the orchestrator. Do not invent kinds.
  Full grammar and the annotate/don't-annotate table: `placeholders-and-annotations.md`
  § Annotation grammar. ISO timestamps come from `date -u +%Y-%m-%dT%H:%M:%SZ`, colons included,
  never sanitized — event filenames depend on that exact shape.

## Signalling the orchestrator

Finish your disk writes first, _then_ send exactly one typed `SendMessage`, in the shape the
Contract's § Worker reports gives for your role. Write-then-signal means disk is consistent before
the orchestrator can act. The message is a routing summary _of_ what you wrote, never a substitute
for it. Keep it to a few lines — which stage, the verdict, the file holding the detail — because the
orchestrator's context runs for the whole pipeline and every line you send is re-read on every turn
it takes afterwards.

After sending a done report, **stop and go idle.** You will not be messaged again; a fresh worker
handles the next round. Do not keep working, poll, or re-message. After `ESCALATING` you are not
done: going idle means waiting for the decision (§ Escalation). The orchestrator stops finished
workers with `TaskStop`; that is expected and needs no response.

The long-lived review-loop worker reports more than once and resumes in place on each reply. Its
payload kinds and reply semantics are in `${SKILLDIR}/references/communication.md` § #2b.

## Escalation

Whether to decide or escalate is `${SKILLDIR}/references/autonomy.md`'s question, answered by the
rework-cost test — **if I'm wrong, what gets thrown away?** — and its list of hard stops. Read it
before your first judgment call. An autonomy violation or a case you cannot classify escalates, full
stop. A contained decision you make instead gets one line in `${SHIPITDIR}/decisions.md` (shape in
`autonomy.md`), so the run stays auditable.

Before escalating an ambiguity, check the project's living docs and any authority the brief names
(a spec, a design doc); escalate only if they are silent too, and say in the event what they said.

1. Save whatever you learned to your stage artifact, even incomplete (atomic rename). A successor
   reads it if you don't survive to get the decision.
2. Write `${SHIPITDIR}/events/<iso>-escalation.md` yourself, whole. Shape and reason codes:
   `${SKILLDIR}/references/escalate-resume.md` § Escalation event shape.
3. Append `> ESCALATED <iso> — <actor>: <reason>; see events/<iso>-escalation.md` to the end of
   `## Annotations`.
4. Send `ESCALATING — see events/<iso>-escalation.md, decision needed on <X>`, then end your turn
   and wait.

The coded reasons are `autonomy_exceeded | error | stall | ambiguity | review_cap`. They name the
common cases, not the legal ones. When none fits — above all when the evidence says your
instructions' next prescribed move would make things worse — escalate with a short free-text reason,
the evidence, and a proposed alternative. Following protocol into a failure you can see coming costs
more than any escalation.

The orchestrator resolves it (auto-resolving, or paging the user), appends the event's
`## Resolution` block and the `> RESOLVED` annotation, then messages you the decision. Read the
Resolution block — disk is authoritative, the message is the wake-up — apply the decision to the
escalated point, finish your stage, and report as normal. If you are gone by then, a fresh spawn
under a new name picks up from your artifacts and that same block (§ Idempotency) — except a
`review_cap`, whose decision the orchestrator carries out itself.

The long-lived review-loop worker has no escalation-by-event path: it surfaces `escalating` inline,
resumes in place, and never writes an escalation event.

## Guardrails common to every role

- **Never edit the brief.** It belongs to the user; the orchestrator is their proxy. You annotate;
  you do not rewrite.
- **Never write outside the artifacts your role owns.** Every file you touch should be one your
  agent definition names.
- **Brief your own subagents to return conclusions, not source.** A subagent's return lands whole
  in your context, so an `Explore` that quotes the files it read hands back the reading you
  delegated to avoid. Ask for the answer and where you'd go to confirm it — a `file:line`, a job
  name, a PR thread — and open that yourself on the rare occasion the text itself matters.
- **Never talk to the user.** That belongs to the orchestrator. Workers own PR voice only where
  their role says so.
- **Never open a peer-worker channel.** The orchestrator dispatches every hop.
- **Workers never merge and never flip the PR to ready.** Both belong to the orchestrator, after its
  own checks and per the brief's merge policy.
