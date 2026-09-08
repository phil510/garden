# Placeholder vocabulary + annotation grammar

## Placeholder vocabulary

Canonical placeholder names. The orchestrator substitutes; workers
consume already-substituted values. Briefs use exactly these names —
no aliases, no drift.

| Placeholder | Set by | Required for | Meaning |
|---|---|---|---|
| `${WORKTREE}` | orchestrator | orchestrator | absolute path to git worktree. Most workers don't read this — they read `${PLANTDIR}`. |
| `${BRANCH}` | orchestrator | all roles (every opener's first line names it) | git branch name |
| `${PLANTDIR}` | orchestrator | all roles | absolute path to `${WORKTREE}/.plant/${BRANCH}/` |
| `${WORKFLOW}` | orchestrator | planner, developer, reviewer | absolute path to `workflow.md` |
| `${MODE}` | orchestrator | developer | selects `initial` or `fix-round` |
| `${ROUND}` | orchestrator | developer fix-round, reviewer internal | review/fix round number (1, 2, 3) |
| `${PR_URL}` | orchestrator | developer (after stage 2 completes), reviewer | PR URL once known |
| `${REVIEW_FILE}` | orchestrator | developer fix-round-from-internal | absolute path to current `review-round-N.md` |

"Required for" lists the roles whose brief actually consumes the value.
An opener may carry a spare, which costs one line and nothing else, so
don't prune an opener to match this column exactly.

Derived paths the briefs use literally (no separate placeholder):
`${PLANTDIR}/events/`, `${PLANTDIR}/plan.md`, `${PLANTDIR}/decisions.md`,
`${PLANTDIR}/review-round-${ROUND}.md`.

**Event filenames are `<iso>-<kind>.md` where `<iso>` is exactly
`date -u +%Y-%m-%dT%H:%M:%SZ`** — colons included, not sanitized. The
scripts split kind from timestamp on that shape; a colon-free variant
falls back to treating the whole basename as the kind, which silently
breaks open-escalation and unrouted-event detection.

**Every worker substitutes mentally.** All three roles are teammates:
the opener carries the literal values, and the worker replaces `${VAR}`
references as it reads its agent definition. There is no `envsubst`
step — the agent definition is never preprocessed, so its `${VAR}`
syntax is read verbatim by the worker.

Adding a placeholder is a SKILL.md change — extend this table first,
then thread the new name through the relevant agent definition. Agent
definitions must not reference placeholders not in this table.

## Annotation grammar

Workers and orchestrator append-only, flat and chronological, at the
end of `## Annotations` — never inserted under a stage's checkbox
line. Each line already carries its own actor and ISO timestamp, so
grouping by stage would add nothing. The harder constraint is that both
script readers anchor annotations at **column 0** — `grep '^>'` in
`pipeline-status.sh:115` and `grep -c '^> ESCALATED'` in
`pipeline-finish.sh:86` — so an indented or checkbox-nested annotation is
silently invisible to status reporting and escalation counting.
`<actor>` is `planner | developer | reviewer | orchestrator`.

- `> NOTE <iso> — <actor>: <line>` — informational breadcrumb for
  **state changes** only. State changes are: stage flip, brief edit,
  escalation lifecycle bookkeeping, worker milestone (e.g., "draft PR
  opened"). Run-time metadata (sub-task IDs, polling ticks) is tracked
  elsewhere — see the table below.
- `> BLOCKED <iso> — <actor>: <reason>` — actively cannot proceed;
  awaiting an external condition the worker expects to recover from
  without escalation.
- `> STALLED <iso> — <actor>: <reason>` — sustained stuck state;
  usually a precursor to `> ESCALATED` if the worker can't recover.
- `> ESCALATED <iso> — <actor>: <reason>; see events/<iso>-escalation.md`
  — explicit handoff to the orchestrator via an escalation event file
  (see `escalate-resume.md`).
- `> RESOLVED <iso> — orchestrator: <what was decided>` — closes a
  prior `> ESCALATED`, or marks a brief edit that resolved a prior
  concern.

These five kinds are the entire vocabulary. Do not invent new kinds
(e.g., `STARTED`, `EDITED`, `RETRY`) — if you find yourself wanting
one, stop and surface it for review. Squeezing new shapes into a
fixed grammar is a signal the design needs to change, not the
grammar.

| Annotate | Don't annotate |
|---|---|
| Stage `- [ ]` → `- [x]` flip (worker, on success) | Worker spawn (orchestrator) — teammates are addressed by role name; there's nothing to record |
| Brief edit by orchestrator (`> RESOLVED`) | Sub-task progress — TaskUpdate metadata covers it |
| Worker milestone (e.g., "draft PR opened") | Anything a downstream worker can derive from `workflow.md` or `events/` |

**Worker self-annotations are the durable record.** The orchestrator
does not echo or duplicate them. If a worker annotates "stage 2
complete", the orchestrator does not also write "spawned developer to
fix round 1" — the developer's eventual annotation is what matters.
The exception is escalation lifecycle: the orchestrator's `> NOTE
orchestrator: paged user; awaiting decision` and `> RESOLVED` mark
state changes that no worker can record.

When scanning a stage's status, the latest annotation wins. A stage is
"complete" when its checkbox is `- [x]` — workers flip it right before
sending their done message.

**Stage 4's checkbox is never flipped.** Neither script touches the
checklist, so nothing ever ticks `- [ ] 4. Finish`. `Status: completed
| aborted` is the actual completion signal for stage 4, not its
checkbox. This matters for the resume path, which reads
`current_stage` — a pipeline that reached the finish gate still
reports stage 4 unticked until `pipeline-finish.sh` runs.
