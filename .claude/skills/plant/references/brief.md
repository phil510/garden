# Brief schema

The 7-field brief lives in `workflow.md` and is the single source of
truth for every worker.

`scripts/pipeline-init.sh` writes this file — you pass it the brief body
(sections 1–7) on stdin and it supplies the header, stage checklist, and
annotations scaffold. Hand-write the file only if the script can't run.

```markdown
# Workflow — <branch>

**Status:** active | completed | aborted
**Started:** <iso — written by pipeline-init.sh, read back for duration>
**Branch:** <branch>
**Worktree:** <absolute path>
**Repo:** <owner/repo>
**PR:** <populated by developer when stage 2 completes>

---

## Brief

### Spec (optional)

<path to a design spec file>

### Size

standard | small (default: standard)

### 1. Objective

<1–3 sentences describing what "done" looks like>

### 2. Scope

**In:** <files/modules/behaviors>
**Out:** <explicit exclusions>

### 3. Acceptance criteria

- <concrete, testable statement>
- <…>

### 4. Verify command

<exact shell command, e.g., `pnpm validate`>

### 5. Autonomy bounds

**Auto:** <behaviors the worker can do without asking>
**Ask first:** <behaviors requiring user approval via escalation>
**Never:** <behaviors the worker must escalate instead of attempting>

### 6. Stop conditions

- PR merged (default — always present)
- <optional extras: absolute ISO timestamp, approval-by-user>

### 7. Merge policy

auto | ask (default: ask)

---

## Stages

- [ ] 1. Plan
- [ ] 2. Develop + draft PR
- [ ] 3. Internal review
- [ ] 4. Finish (CI + merge)

## Annotations

(append-only, written by workers and orchestrator. Annotations are
appended flat and chronological at the end of this section — never
inserted under a stage's checkbox line. See
`placeholders-and-annotations.md` § Annotation grammar for why.)
```

When `Spec:` is present, §3 (Acceptance criteria) may be omitted — the
planner derives ACs from the spec's Testing section into `plan.md`
instead. §1–2 may point at the spec's Context and goals section rather
than restate it. §4–7 stay required regardless — a spec is
consumer-agnostic and never carries pipeline-specific fields like these.

`Size: small` means the change is known file-by-file before starting,
fits in one commit or a couple, and involves no design decision — a
few-line code change, a config value, a dependency bump. It still
requires §1–7: the ACs are the developer's task list in place of a
plan, so they must be concrete. `standard` is the default.

## Stage 0 — deriving the brief from the artifact

The brief is derived, not negotiated: §1–3 come from the artifact
describing the work, §4–7 from the repo and `autonomy.md`. plant's
entrypoint hands you one artifact kind — a GitHub issue, read with
`gh issue view <n> --json title,body,comments,labels,url`. Read the
whole comment thread before drafting §1–3: a later comment can
contradict, narrow, or supersede the body, and the body carries no
extra authority for having been written first.

| Field                                          | Source                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1. Objective, 2. Scope, 3. Acceptance criteria | the artifact — for an issue, its body and full comment thread                                                         |
| 4. Verify command                              | the repo — `pnpm validate` is the gate (typecheck, lint, format check, unit tests); `pnpm test` is the unit tier only |
| 5. Autonomy bounds                             | defaults from `autonomy.md`                                                                                           |
| 6. Stop conditions                             | `PR merged`                                                                                                           |
| 7. Merge policy                                | `auto \| ask`, default `ask`                                                                                          |

**The triage gate.** Artifacts vary in quality, so the gate isn't
whether this one is good — it's whether it answers _what to build_
without you supplying the answer:

- Clear on what to build → write `workflow.md`, print the derived
  brief, and proceed without waiting. Confirming a brief that merely
  transcribed a well-written artifact buys nothing.
- Ambiguous or self-contradictory about what to build → ask the user
  about exactly that, once, then proceed. Silence where §1–3 need an
  answer counts, and so does a comment pulling against the body.

The line is _what_ versus _how_. The user decides what we build, so a
gap there is theirs to close; how to build it is yours and the
planner's, and the small decisions that involves don't come back to
them. Escalate a gap rather than resolving it plausibly: an assumption
at stage 0 is the most expensive kind, because everything downstream
inherits it and by the time it surfaces the planner or developer has
already built on top of it.

Do not re-derive §4–7 from the user; they come from the repo and
`autonomy.md` regardless of artifact quality.

## Write discipline

`workflow.md` is append-only and written by atomic rename: read, append,
write `workflow.md.tmp`, then `mv workflow.md.tmp workflow.md`. A crash
mid-write leaves an orphan `.tmp` rather than a truncated `workflow.md`,
which matters because every fresh-spawned worker rebuilds its state from
this file. Never rewrite or delete a prior annotation line.

On stage success, the worker's last action flips its checkbox `- [ ]` →
`- [x]` in the same atomic write as its final `> NOTE` line, so a reader
never sees a completed stage without its annotation. Annotation kinds are
fixed — see `placeholders-and-annotations.md` § Annotation grammar.

## Brief editing mid-pipeline

When a user resolution changes scope:

1. Use the `Edit` tool to update the brief field directly (atomic at
   the FS layer).
2. Append an audit annotation (flat, at the end of `## Annotations` —
   never inserted under the stage the escalation happened in):
   ```
   > RESOLVED <iso> — orchestrator: edited AC3 per user decision in
   >   escalation <iso>; was "promote using-subagents to stable" →
   >   now "keep using-subagents in experimental"
   ```
3. If the edit invalidates a prior artifact (`plan.md`, a review
   round), append a matching annotation noting invalidation. Staleness
   is detected by comparing the brief edit's ISO to the artifact's
   timestamp — no version counter needed. Fresh-spawn the affected stage
   with the new brief, unless the change is a small edit (§ Mid-pipeline
   user concerns), which takes one developer and no re-review. The other
   exception is a stage whose worker is waiting on this very escalation:
   it is not replaced, it re-reads the brief when the decision message
   arrives.

Scope changes narrow as often as they grow. An AC that has run past a
short paragraph has usually absorbed implementation detail that
belongs in `plan.md` or the code — and every extra clause is one more
rule a later fix can contradict. When a resolution narrows scope, cut
the AC down rather than appending qualifiers.

Pivots, where the user replaces a requirement rather than adjusting it,
are rare and costly when handled as edits. Hold at the next worker
boundary and dispatch nothing until the replacement is settled: every
worker spawned on a half-decided requirement builds code the next
decision deletes. Then rewrite everything in the brief the old
requirement reaches, not just the sentence carrying the new answer — a
stale AC left beside an annotation gives the next worker two
instructions to choose between. Say whether the old code is deleted now
or kept for compatibility, after checking what still calls it, so the
developer neither strands a caller nor leaves dead code for the
reviewer to review. Invalidate affected artifacts per step 3.

The orchestrator edits the brief only **between worker invocations**
(at an escalation pause or stage boundary). Never while a worker is
running — single-writer-per-moment extends to the brief. An escalation
pause counts as between invocations: the escalator is waiting, not
working. The edit lands on disk before the decision message, and the
message tells the escalator to re-read the brief.

**Workers never edit the brief.** The brief belongs to the user; the
orchestrator is the user's proxy.

## Mid-pipeline user concerns

The user may volunteer a concern mid-pipeline — a change of mind, a
note on the diff they just reviewed, a scope clarification — outside
any escalation. A message from an orchestrating session that carries
the user's decision about the work counts the same; merge stays with
field 7 and the user directly. The orchestrator treats it as authorial
input that can override the brief, not as another reviewer finding:

1. Classify the concern: is it a scope/spec change (edit the brief), a
   concrete code-level ask (synthesize a findings-shaped input and
   dispatch a developer fix-round), or both? A standing decision about
   what the pipeline may do, such as a base branch on hold or a check
   the user deferred, is a brief edit to field 5 (Autonomy bounds), one
   line each: `base <branch> on hold (user, <iso>)`, `check <name>
deferred (user, <iso>)`.
2. If brief-editing: follow § Brief editing mid-pipeline, with the
   audit annotation citing "user concern" instead of an escalation
   ISO. Invalidate affected artifacts the same way.
3. If fix-round: synthesize a minimal findings-shaped input (`## User
concern` section with `Disposition: fix`, `Severity`, `Location`,
   `Issue`, `Failure scenario`), write it into the next-numbered
   `review-round-N.md` (the developer's fix-round mode reads
   `${REVIEW_FILE}`, and `review_rounds` counts it as it counts finish-gate
   rounds), and dispatch the developer as a fresh fix-round spawn. A
   small edit — the outcome is settled, the code location is known, and
   it changes no contract, security boundary or data invariant — ends
   there once stage 3 is ticked, with no reviewer after it: reviewing a
   decided, located change can only re-litigate the decision. Re-enter
   the finish gate at step 10(a)'s mergeability check. Line count isn't
   the test; a one-line change to an auth check is not small. Before
   stage 3 is ticked, a small edit joins the normal sequence and the
   next reviewer round sees it, since only a clean review flips that
   checkbox. Anything larger goes through the usual developer→reviewer
   rounds, under the round cap.
4. Same single-writer-per-moment rule applies — act only between
   worker invocations. If a worker is running, wait for it to report
   and treat it as idle before editing the brief or dispatching. A
   worker waiting on an escalation is not running: edit the brief, then
   tell it to re-read it in the decision message; a concern that is a
   fix-round ask waits until that worker reports.

When told to batch — syncing several stacked PRs, say — dispatch
developers without review until told the batch is done, then review the
final head once. Each intermediate head is superseded before anyone
merges it, so reviewing it pays for findings on code that never ships.

The user's authorial word trumps the brief. If a concern contradicts
an active AC, edit the AC; don't route the user's own note through
reviewer classification.
