---
name: ship-it
description: >
  Run a scoped change end-to-end as a background pipeline — plan, develop, draft PR, internal
  review, an optional review-bot loop, ready flip, then watch it through merge. Invoked as
  `/garden:ship-it <ref | free text>`, or `/garden:ship-it resume` to re-hydrate an interrupted
  pipeline. Requires a garden session.
---

# Ship-it

You are the **orchestrator** for a multi-stage PR pipeline that runs over hours or days. You
derive a brief, spawn workers as teammates, route their signals, and page the user when a decision
is theirs. The Contract below is the single source every reference and worker definition quotes;
when one of them seems to disagree with it, the Contract wins.

<!-- body: task 7 -->

## Contract

These are the names, shapes and values that the orchestrator, the four workers, the references and
the scripts all depend on. Each one is read by more than one actor, so changing one here means
changing every reader.

### Names

- **Skill:** `/garden:ship-it`. **Worker agent types** (the `subagent_type` on every spawn):
  `garden:ship-it-planner`, `garden:ship-it-developer`, `garden:ship-it-reviewer`,
  `garden:ship-it-review-loop`. A plugin's agents are namespaced by the plugin, so the bare
  `ship-it-<role>` names either fail to resolve or resolve to someone's personal copy.
- **Worker names** (the `name` on each spawn, used for `SendMessage` and `TaskStop`): `<role><n>`
  with a per-role counter that increments on every spawn and is never reused — `planner1`,
  `developer2`, `reviewer3`. The review loop is a singleton named `review-loop` (`review-loop2`
  only to replace a misbehaving one).

### Paths

- **`${SKILLDIR}`** is this skill's base directory — the directory announced when the skill
  loaded. Every path into the skill is built from it: scripts are `${SKILLDIR}/scripts/pipeline-*.sh`,
  references `${SKILLDIR}/references/<name>.md`. The working directory is the project, so a bare
  `scripts/…` or `references/…` either fails or hits a file the project ships.
- **Every worker reads `${SKILLDIR}/references/worker-protocol.md` first**, then its own role
  content. The orchestrator never reads that file or a worker definition.
- **State directory** `<worktree>/.ship-it/<branch>/` (`${SHIPITDIR}`), created by
  `pipeline-init.sh`, which also writes `<worktree>/.ship-it/.gitignore` containing `*` so the
  state never shows in `git status`:

  ```
  <worktree>/.ship-it/
    .gitignore                `*`
    active                    single-pipeline lock; one line: the branch
    <branch>/
      workflow.md             header + brief + stage checklist + annotations
      decisions.md            append-only log of auto-resolved gates and accepted limitations
      plan.md                 planner output (absent for Size: small)
      review-round-N.md       internal review output, one per round
      review-loop-state.json  review-loop position and outcome (absent until the loop starts)
      review-loop.log         review-loop worker's log; human-only
      events/<iso>-<kind>.md  PR activity intakes and escalations
  ```

### Opener variables

Each spawn's prompt is a thin opener carrying literal values (absolute paths for path-valued vars);
the worker substitutes them mentally wherever its instructions say `${VAR}`.
`references/placeholders-and-annotations.md` defines each one.

| Role                  | Vars in the opener                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| planner               | `SKILLDIR`, `BRANCH`, `SHIPITDIR`, `WORKFLOW`                                                                    |
| developer (initial)   | + `MODE`                                                                                                         |
| developer (fix-round) | + `PR_URL`, `MODE`, `ROUND`, and `REVIEW_FILE` or `EVENT_FILE`                                                   |
| reviewer (internal)   | + `PR_URL`, `MODE`, `ROUND`                                                                                      |
| reviewer (external)   | + `PR_URL`, `MODE`, and `DIGEST` (`none` when no digest prompted the spawn) — or `EVENT_FILE` to finish an event |
| review-loop           | + `PR_URL`, `WORKTREE`, `REVIEW_LOOP`                                                                            |

`REVIEW_LOOP` is the skill name from the brief's `Review loop` field; the review-loop worker is
spawned only when that field is not `none`.

### Brief

`workflow.md`'s `## Brief` section opens with four bold header fields, then seven numbered
sections. The scripts read the header fields by their exact `**Name:**` spelling at column 0, so
every field is always written — `none` rather than omitted.

```markdown
**Tracker:** <ref exactly as the tracker writes it> | none
**Review loop:** <skill name> | none
**Spec:** <path to a design spec> | none
**Size:** standard | small

### 1. Objective

### 2. Scope

### 3. Acceptance criteria

### 4. Verify command

### 5. Autonomy bounds

### 6. Stop conditions

### 7. Merge policy

ask | auto
```

- **Tracker** — the work item the PR links or closes; `none` for free-text intake.
- **Review loop** — a skill the injected instructions name for driving review-bot feedback before
  ready; `none` when nothing names one. It is the persisted record of whether the pre-ready gate
  runs, which is what lets a resume tell "skipped" from "never started".
- **Merge policy** — `ask` (the default) pages the user once the PR is merge-eligible; `auto`
  merges, except that a repo with no CI still gets a confirmation first.

### Review-loop outcome

The pre-ready gate ends in exactly one of `skipped | passed | blocked`.

- `skipped` — the brief's `Review loop` is `none`. Nothing is spawned and no state file is written;
  `pipeline-status.sh` derives it from the brief.
- `passed` — the loop skill reached its own success condition: no actionable bot feedback left.
- `blocked` — anything else: a round cap, a stall, the bot stopped responding, the named skill
  isn't available in the session, or the repo has no bot that skill can drive.

`pipeline-status.sh` reports `review_loop.outcome` as one of those three, or `pending` (named, no
state file yet) or `running` (state file present, `phase` not `done`). Resume branches on that
field, never on whether the state file exists.

`review-loop-state.json` is rewritten atomically by the review-loop worker on every transition:

```json
{
  "bot": "<bot key>",
  "trigger": "<comment that requests a re-review>",
  "round": 2,
  "phase": "triaging | implementing | awaiting-rereview | awaiting-decision | done",
  "trigger_ts": "<iso of the last trigger comment>",
  "outcome": null,
  "reason": null,
  "skill_dir": "<absolute base directory of the loop skill the worker loaded>"
}
```

`outcome` stays `null` until `phase` becomes `done` in the same write, then is `passed` or
`blocked`; `reason` is a one-line why for `blocked` (the loop skill's terminal condition, or why it
couldn't run). `skill_dir` lets the orchestrator run the loop skill's backstop without a hardcoded
path: when `<skill_dir>/scripts/backstop.sh` exists, it is run as
`<skill_dir>/scripts/backstop.sh <bot> <owner/repo> <pr-number> <trigger_ts>`; when it doesn't,
digests are the only wake-up.

The orchestrator records the outcome in `workflow.md` with exactly this line, which the external
reviewer reads as the loop's boundary:

```
> NOTE <iso> — orchestrator: review loop <skipped|passed|blocked>
```

The PR flips to ready on `passed` or `skipped`. On `blocked` it stays draft and the user is asked.

### Worker reports

Each worker finishes its disk writes, then sends exactly one of these as a `SendMessage`. The
orchestrator routes off the first line.

| Worker               | Report                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| planner              | `stage 1 done — plan.md written, <N> tasks, coverage table complete`                                                                        |
| developer, initial   | `stage 2 done — draft PR <url>, commits <shas>` + mergeability line                                                                         |
| developer, fix-round | `fix-round <K> done — <N> findings fixed, commits <shas>, pushed` + mergeability line                                                       |
| reviewer, internal   | `round <K> clean — PR remains draft` (then one line per accepted limitation) or `round <K> dirty — <M> fix findings in review-round-<K>.md` |
| reviewer, external   | `nothing-new`, `event <file> classified — <P> fix, <Q> decline, <R> escalate`, `pr merged`, or `pr closed`                                  |
| review-loop          | `triggered`, `escalating`, or `done: <passed\|blocked>` — shapes in `references/communication.md` § #2b                                     |
| any stage worker     | `ESCALATING — see events/<iso>-escalation.md, decision needed on <X>`                                                                       |

- **Mergeability line** (developer, both modes): `mergeability: <mergeable> / <mergeStateStatus> at
<head-sha>`, from `gh pr view --json mergeable,mergeStateStatus,headRefOid` after the last push.
  The developer never reports `CONFLICTING`: it merges the base, re-runs verify, pushes, and checks
  again. `UNKNOWN` is retried under a bound and reported as-is if it never settles.
- **`clean <head-sha>`** (reviewer, external): `nothing-new`, or a classification with zero `fix`
  and zero `escalate`, gains `; clean <head-sha>` — the pipeline has nothing open at that head. It
  is a prompt for the orchestrator's merge-eligibility check, not a verdict on merge readiness; the
  reviewer reads no merge state and no review decision.

### Ownership

- **Workers never merge and never flip ready.** The orchestrator alone runs `gh pr ready` (after the
  pre-ready gate) and `gh pr merge` (after its own eligibility check, per `Merge policy`).
- **Live-worker ledger.** The orchestrator tracks, per role, the live worker's name, its state
  (working, waiting on an escalation, reported) and the next counter — in its own context, for the
  current session only. Teammates do not survive the orchestrator's session, so on resume nothing
  is live and every counter restarts at 1.
