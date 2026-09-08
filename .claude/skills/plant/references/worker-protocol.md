# Plant worker protocol

Everything here is true for every plant worker. Your own agent
definition carries what is specific to your role; where the two touch
the same thing, your role file wins on role-specific detail and this
file wins on the shared mechanics.

## How you were spawned

You are a **teammate** of the orchestrator (the team lead), created via
the `Agent` tool with full tool access. Your opener names your role,
your branch, and the paths you work against. Those values arrive
**already substituted** — the opener carries literal paths where this
file and your role file write `${PLANTDIR}`, `${WORKFLOW}`,
`${BRANCH}`, `${MODE}`, and the rest. Nothing preprocesses the text you
read, so substitute mentally as you go; there is no `envsubst` step and
you never run one. The canonical names and meanings are in
`.claude/skills/plant/references/placeholders-and-annotations.md`
§ Placeholder vocabulary.

You work inside a git worktree, reached by the absolute paths in your
opener. Do not `cd` into it and do not assume a working directory.

You do not talk to a human. You message only the orchestrator — there
are no peer-worker channels. Everything else you have to "say" lives on
disk.

## Idempotency

There is no resume primitive. Every re-entry into a stage is a **fresh
spawn**: a cold start and a post-escalation replacement are the same
code path, and must produce the same outcome.

Rebuild your state from `${WORKFLOW}` plus the stage artifacts on disk —
`${PLANTDIR}/plan.md`, `${PLANTDIR}/events/`, `review-round-*.md`, and
whatever your role names. Never lean on in-memory continuity from a
prior session or a prior turn.

Trust the prior artifacts as written, including any
`## Acceptance criteria (derived from spec)` section a planner wrote
into `plan.md`. The one thing that overrides them is a recorded
decision: if you see an `> ESCALATED` annotation followed by
`> RESOLVED`, read the named event file in `${PLANTDIR}/events/` and
its `## Resolution` block. Treat the Decision and Rationale as binding
on the escalated point, and pick up from where the escalation paused
rather than redoing settled work. The user's Decision may be free text
rather than one of the suggested options; interpret it against those
options and the brief.

While you are the active stage worker you are the sole writer to
`${WORKFLOW}` (single-writer-per-moment, enforced by the orchestrator's
sequential dispatch).

## Resolving your inputs

Read `${WORKFLOW}` in full before anything else. The 7-field brief at
the top is your source of truth: Objective, Scope, Acceptance criteria,
Verify command, Autonomy bounds, Stop conditions, Merge policy. Field 7
is consumed by the orchestrator; other roles don't act on it. Re-read
the brief whenever you're about to make a judgment call — the
orchestrator can edit it mid-pipeline, so a stale opener may drift from
it.

Three input shapes exist. Identify yours from the brief's fields:

- **Standard.** The brief's §3 Acceptance criteria are the ACs, and
  `${PLANTDIR}/plan.md` holds the task list.
- **Spec-backed** (`Spec:` present, §3 absent). The ACs are the
  planner-derived `## Acceptance criteria (derived from spec)` section
  in `plan.md`. Read the spec in full; its Architecture and
  Costly-to-reverse decisions are **settled** — do not re-derive them.
  Something that contradicts a settled decision is an escalation
  (`reason: ambiguity`), not a judgment call.
- **Small** (`Size: small`). There is no `plan.md`. The brief's §3 ACs
  are the task list, and there is no coverage table to write or check.

What you do with the ACs and tasks once you have them is role-specific
and lives in your agent definition.

## Write discipline

- **`workflow.md` is append-only.** Annotations go at the end of
  `## Annotations`, flat and chronological — never inserted under a
  stage's checkbox line in `## Stages`, and never indented. The
  pipeline's shell scripts match annotations at **column 0**; an
  indented or nested one is silently invisible to status reporting and
  escalation counting. Workers never rewrite prior annotations.
- **Atomic rename for every state-file write.** Write `<file>.tmp`,
  then `mv <file>.tmp <file>`. A mid-write crash then leaves an orphan
  `.tmp`, not a corrupt artifact.
- **Stage workers (planner, developer, reviewer) flip their checkbox
  in the same atomic write as the final `> NOTE`.** One write changes
  `- [ ]` → `- [x]` in `## Stages` and appends the note; then you
  signal.
- The annotation grammar is exactly five kinds — `> NOTE`,
  `> BLOCKED`, `> STALLED`, `> ESCALATED`, `> RESOLVED` — and
  `> RESOLVED` belongs to the orchestrator. Do not invent kinds. Full
  grammar, actor vocabulary, and the annotate/don't-annotate table:
  `placeholders-and-annotations.md` § Annotation grammar. ISO
  timestamps come from `date -u +%Y-%m-%dT%H:%M:%SZ`, colons included,
  never sanitized — event filenames depend on that exact shape.

## Signalling the orchestrator

Finish your disk writes first, _then_ send exactly one typed
`SendMessage`. Write-then-signal: disk is consistent before the
orchestrator can act on the signal. The message is a routing summary
_of_ what you wrote, never a substitute for it — the orchestrator reads
disk on demand, and a fresh worker rebuilds entirely from disk.

After sending, **stop and go idle.** You will not be messaged again; a
fresh worker handles the next round, and you may remain idle until the
session ends. Do not keep working, poll, or re-message.

## Escalation

When you hit ambiguity, an autonomy violation, or a case you cannot
classify, escalate rather than gate. The orchestrator decides the next
move.

1. Save whatever you learned to your stage artifact, even incomplete
   (atomic rename). Your successor reads it.
2. Write `${PLANTDIR}/events/<iso>-escalation.md` yourself, whole —
   there is no orchestrator-populated resume metadata and no
   `Worker UUID` field. Shape and reason codes:
   `.claude/skills/plant/references/escalate-resume.md` §
   Escalation event shape.
3. Append `> ESCALATED <iso> — <actor>: <reason>; see
events/<iso>-escalation.md` to the end of `## Annotations`.
4. Send `ESCALATING — see events/<iso>-escalation.md, decision needed
on <X>`, then stop and go idle.

The coded reasons are `autonomy_exceeded | error | stall | ambiguity |
review_cap`. They name the common cases, not the legal ones. When none
fits — above all when the evidence says your instructions' next prescribed
move would make things worse — escalate with a short free-text reason,
the evidence, and a proposed alternative. Free-text escalations route
exactly like coded ones. Following protocol into a failure you can see
coming costs more than any escalation.

The orchestrator pages the user, appends the `## Resolution` block, and
fresh-spawns a replacement under the next-numbered name with the
decision in its opener. You stay idle; treat yourself as dead.

## Guardrails common to every role

- **Never edit the brief.** It belongs to the user; the orchestrator is
  their proxy. You annotate; you do not rewrite.
- **Never write outside the artifacts your role owns.** Every file you
  touch should be one your agent definition names.
- **Never talk to the user.** That belongs to the orchestrator. Workers
  own PR voice only where their role says so.
- **Never open a peer-worker channel.** The orchestrator dispatches
  every hop.
- **Plant never merges.** The user clicks merge, or auto-merge fires.
