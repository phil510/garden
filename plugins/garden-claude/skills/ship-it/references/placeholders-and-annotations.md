# Placeholder vocabulary + annotation grammar

## Placeholder vocabulary

Canonical placeholder names. The orchestrator substitutes; workers consume already-substituted
values. Which role's opener carries which variable is fixed in SKILL.md's Contract § Opener
variables; this table says what each one means.

| Placeholder      | Meaning                                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${SKILLDIR}`    | absolute base directory of the ship-it skill, as announced when it loaded. Every path into the skill — `references/`, `scripts/` — is built from it.                                                                                                            |
| `${WORKTREE}`    | absolute path to the git worktree — where every git, `gh` and project command runs, since a worker's working directory may be the main checkout                                                                                                                 |
| `${BRANCH}`      | git branch name                                                                                                                                                                                                                                                 |
| `${SHIPITDIR}`   | absolute path to `${WORKTREE}/.ship-it/${BRANCH}/`                                                                                                                                                                                                              |
| `${WORKFLOW}`    | absolute path to `workflow.md`                                                                                                                                                                                                                                  |
| `${MODE}`        | selects the mode section in a dual-mode role: developer `initial` or `fix-round`, reviewer `internal` or `external`                                                                                                                                             |
| `${ROUND}`       | internal: the review round (at most 3, or 1 on `Size: small`); external fix round: one more than the `## Developer round` sections already in `events/`                                                                                                         |
| `${PR_URL}`      | PR URL once the developer has opened it                                                                                                                                                                                                                         |
| `${DIGEST}`      | the PR-watch digest line that triggered the spawn, verbatim; its `[digest <id>]` is what the reviewer reads the items from. `none` when a resume or the post-loop triage spawned the reviewer with no digest behind it                                          |
| `${EVENT_FILE}`  | absolute path to an `events/<iso>-activity.md`: for the developer, the one the reviewer reported classifying; for the reviewer, an unclassified one a dead reviewer left behind, or the one an escalated reviewer classified (the escalation's `**Artifact:**`) |
| `${REVIEW_FILE}` | absolute path to the current `review-round-N.md`                                                                                                                                                                                                                |
| `${REVIEW_LOOP}` | the skill name from the brief's `Review loop` field — the skill the review-loop worker runs                                                                                                                                                                     |

An opener may carry a spare, which costs one line and nothing else, so don't prune an opener to
match the Contract's table exactly.

Derived paths the agent definitions use literally (no separate placeholder):
`${SHIPITDIR}/events/`, `${SHIPITDIR}/plan.md`, `${SHIPITDIR}/decisions.md`,
`${SHIPITDIR}/review-loop.log`, `${SHIPITDIR}/review-loop-state.json`,
`${SHIPITDIR}/review-round-${ROUND}.md`. The review-loop worker derives `<owner>/<repo>` from
`${PR_URL}`.

**Event filenames are `<iso>-<kind>.md` where `<iso>` is exactly `date -u +%Y-%m-%dT%H:%M:%SZ`** —
colons included, not sanitized. The scripts split kind from timestamp on that shape; a colon-free
variant falls back to treating the whole basename as the kind, which silently breaks
open-escalation and unrouted-event detection.

**Every worker substitutes mentally.** All four roles are teammates: the opener carries the literal
values, and the worker replaces `${VAR}` references as it reads its agent definition. The agent
definition is never preprocessed, so its `${VAR}` syntax is read verbatim.

Adding a placeholder is a Contract change — extend the Contract's opener table and this one first,
then thread the new name through the agent definitions. Agent definitions must not reference a
placeholder absent from this table.

## Annotation grammar

Workers and orchestrator append-only, flat and chronological, at the end of `## Annotations` —
never under a stage's checkbox line. Each line already carries its actor and timestamp, so grouping
by stage would add nothing. The harder constraint is that the scripts anchor annotations at
**column 0** — `pipeline-status.sh` reads `^>` lines and `pipeline-finish.sh` counts
`^> ESCALATED` — so an indented or nested annotation is silently invisible to status reporting and
escalation counting. `<actor>` is `planner | developer | reviewer | review-loop | orchestrator`;
the review-loop worker never writes `workflow.md` in practice, but it is a valid actor value.

- `> NOTE <iso> — <actor>: <line>` — informational breadcrumb for **state changes** only: stage
  flip, brief edit, escalation bookkeeping, worker milestone ("draft PR opened"), PR watch started
  or opted out, the review-loop outcome (exact wording in the Contract § Review-loop outcome), PR
  flipped to ready, PR merged.
- `> BLOCKED <iso> — <actor>: <reason>` — actively cannot proceed; awaiting an external condition
  the worker expects to recover from without escalation.
- `> STALLED <iso> — <actor>: <reason>` — sustained stuck state; usually a precursor to
  `> ESCALATED`.
- `> ESCALATED <iso> — <actor>: <reason>; see events/<iso>-escalation.md` — explicit handoff to the
  orchestrator via an escalation event file (`escalate-resume.md`).
- `> RESOLVED <iso> — orchestrator: <what was decided>` — closes a prior `> ESCALATED`, or marks a
  brief edit that resolved a prior concern. Written before the decision is sent to the escalator,
  so the decision is on disk first.

These five kinds are the whole vocabulary. Do not invent new ones (`STARTED`, `EDITED`, `RETRY`) —
wanting one is a signal the design needs to change, not the grammar.

| Annotate                                          | Don't annotate                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Stage `- [ ]` → `- [x]` flip (worker, on success) | Worker spawn — teammates are addressed by name; there's nothing to record      |
| Brief edit by orchestrator (`> RESOLVED`)         | Sub-task progress — task metadata covers it                                    |
| `> ESCALATED` → `> RESOLVED` lifecycle            | Anything a downstream worker can derive from `workflow.md` or `events/`        |
| Worker milestone (e.g. "draft PR opened")         | A decision or accepted limitation — that's a `decisions.md` line, not a `NOTE` |

**Worker self-annotations are the durable record.** The orchestrator does not echo them: if a
worker annotates "stage 2 complete", the orchestrator doesn't also write "spawned developer". The
exceptions are state changes no worker can record — escalation lifecycle, the review-loop outcome,
the ready flip, the merge.

When scanning a stage's status, the latest annotation wins. A stage is complete when its checkbox
is `- [x]` — workers flip it right before sending their done report.

**Stage 4's checkbox is never flipped.** Neither script touches the checklist, so nothing ever
ticks `- [ ] 4. Finish`. `Status: completed | aborted` is the completion signal for stage 4. This
matters on resume, which reads `current_stage`: a pipeline that reached the pre-ready gate, the
watch, or the merge still reports stage 4 unticked, even after `pipeline-finish.sh` has run.
