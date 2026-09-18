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

## Stage 0 — deriving the brief from the issue

`/plant <issue-number>` starts by reading the issue:
`gh issue view <n> --json title,body,comments,labels,url`. There is no
interactive negotiation — the brief is derived from the issue plus the
repo, and only §1–3 come from the issue at all:

| Field                                          | Source                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1. Objective, 2. Scope, 3. Acceptance criteria | the issue body and its comment thread                                                                                 |
| 4. Verify command                              | the repo — `pnpm validate` is the gate (typecheck, lint, format check, unit tests); `pnpm test` is the unit tier only |
| 5. Autonomy bounds                             | defaults from `autonomy.md`                                                                                           |
| 6. Stop conditions                             | `PR merged`                                                                                                           |
| 7. Merge policy                                | `auto \| ask`, default `ask`                                                                                          |

**The triage gate.** GitHub issues vary as much in quality as any other
ticket source, so the gate isn't "is this issue good" — it's whether
§1–3 were read off the issue or invented to fill a gap:

- Read them off the issue → write `workflow.md`, print the derived
  brief, and proceed without waiting. Ceremonially confirming a brief
  that merely transcribed a well-written issue buys nothing.
- Invented or guessed any part of §1–3 → ask the user about exactly
  that part, once, then proceed. An assumption at stage 0 is the most
  expensive kind — everything downstream inherits it, and by the time
  it surfaces the planner or developer has already built on top of it.

Do not re-derive §4–7 from the user; they come from the repo and
`autonomy.md` regardless of issue quality.

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
   with the new brief.

Scope changes narrow as often as they grow. An AC that has run past a
short paragraph has usually absorbed implementation detail that
belongs in `plan.md` or the code — and every extra clause is one more
rule a later fix can contradict. When a resolution narrows scope, cut
the AC down rather than appending qualifiers.

The orchestrator edits the brief only **between worker invocations**
(at an escalation pause or stage boundary). Never while a worker is
running — single-writer-per-moment extends to the brief.

**Workers never edit the brief.** The brief belongs to the user; the
orchestrator is the user's proxy.

## Mid-pipeline user concerns

The user may volunteer a concern mid-pipeline — a change of mind, a
note on the diff they just reviewed, a scope clarification — outside
any escalation. The orchestrator treats it as authorial input that can
override the brief, not as another reviewer finding:

1. Classify the concern: is it a scope/spec change (edit the brief), a
   concrete code-level ask (synthesize a findings-shaped input and
   dispatch a developer fix-round), or both?
2. If brief-editing: follow § Brief editing mid-pipeline, with the
   audit annotation citing "user concern" instead of an escalation
   ISO. Invalidate affected artifacts the same way.
3. If fix-round: synthesize a minimal findings-shaped input (`## User
concern` section with `Disposition: fix`, `Severity`, `Location`,
   `Issue`, `Failure scenario`) and dispatch the developer per the
   fresh-spawn path.
4. Same single-writer-per-moment rule applies — act only between
   worker invocations. If a worker is running, wait for it to report
   and treat it as idle before editing the brief or dispatching.

The user's authorial word trumps the brief. If a concern contradicts
an active AC, edit the AC; don't route the user's own note through
reviewer classification.
