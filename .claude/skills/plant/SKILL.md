---
name: plant
description: >-
  Runs a scoped GitHub issue end-to-end as a background pipeline: derive a
  brief from the issue, plan, develop, draft a PR, run internal review, then
  a finish gate that flips the PR to ready, waits on CI, and merges per the
  brief's merge policy. Invoked as `/plant <issue-number>`, or `/plant
  resume` to re-hydrate an interrupted pipeline. Requires a
  `bypassPermissions` session.
---

# Plant

You are the **orchestrator** and team lead for a multi-stage PR pipeline
that runs over hours. Derive a brief from a GitHub issue, spawn workers as
teammates, route their signals, page the user when a worker escalates. You
are the only actor that talks to the user. Workers own PR voice — you never
reply, resolve, or merge on the PR.

Three workers, one implicit team (it forms on the first named spawn; there
is no `TeamCreate` step). Each is spawned with the `Agent` tool under a
unique name as a named agent (`plant-<role>`) whose definition is its
instruction set, and reports back with a typed `SendMessage`.

## Invariants

Six things the rest of this skill assumes. Each is load-bearing for a
reason worth understanding, because the failure modes are silent.

- **You never do stage work yourself.** Every plan, commit, and review
  runs in a teammate. Your context is the routing table for a pipeline
  that may run for hours; spending it on a diff is how a long pipeline
  degrades into a confused one. If you're about to edit code, spawn a
  worker instead. The same line bars _commissioning_: don't dispatch work
  no finding, plan task, or user decision asked for — it skips the review
  loop and the audit trail. Ticking stage 1 for a `Size: small` pipeline
  is bookkeeping, not stage work — no plan is produced, so nothing is
  commissioned.
- **You never read worker agent definitions or `worker-protocol.md`.**
  Each worker reads its own agent definition in its own context. Peeking
  at one to "check what it says" leaks 4–8K tokens into your context for
  information the worker already has, and buys nothing — the opener
  carries everything you need to know about a spawn.
- **Route off the worker's message; read disk on demand.** A worker
  finishes its disk writes, then sends a message summarizing exactly what
  it did. That message is the fast path. Read `workflow.md` / `events/`
  only when you need detail you chose not to inline, or when a
  high-stakes hop warrants verification (the finish gate, pipeline
  completion, a contradictory signal) — and prefer `scripts/pipeline-status.sh`
  over raw reads.
- **A bare `teammate-terminated` with no preceding result message means the
  worker died mid-stage.** The message-based fast path has nothing to
  route, so fall back to `scripts/pipeline-status.sh` to classify what (if
  anything) completed, then fresh-spawn. Disk is the always-correct
  fallback; the message is only the optimization.
- **Resolve ambiguity at stage 0.** An artifact read carelessly doesn't
  fail early — an assumption about _what_ to build produces an
  escalation at every stage that inherits it, which costs far more of
  the user's attention than one question up front would have. The
  triage gate (`references/brief.md`) is where this gets caught.
- **Assume the session has the autonomy the pipeline needs**
  (`bypassPermissions`). Workers inherit the session's permission mode and
  a per-spawn `mode` doesn't override it, so a worker that hits a prompt
  with nobody attached stalls invisibly — no escalation, no message, no
  signal, which is the exact failure unattended operation exists to
  prevent. Nothing lets a session read its own mode, so **spawn without
  asking**: whoever ran `/plant` knows the precondition and will say so
  when it doesn't hold. Rationale and boundaries:
  `references/spawn-details.md` § Permission mode.

Two consequences worth holding in mind: **briefs are idempotent** (a fresh
teammate rebuilds all state from `workflow.md` + stage artifacts, which is
what makes fresh-spawn-per-round safe and makes resume work without a
resume primitive), and **session death takes all three workers** with it.
Disk state survives; in-memory state does not.

There is **no auto-rollback** — bad commits stay, and the user decides
cleanup.

## Where to look up details

This file is the dispatch document. Mechanics live in `references/`,
loaded only when needed.

| When you need…                                                                                               | Read                                         |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Brief schema, stage 0 derivation, the triage gate, mid-pipeline edits, user concerns                         | `references/brief.md`                        |
| The autonomy ladder — what's decide-and-log versus a hard stop, and why; default brief bounds                | `references/autonomy.md`                     |
| Naming/counters, worker lifecycle, opener vocabulary, permission mode, why-this-shape                        | `references/spawn-details.md`                |
| Escalation protocol, escalation event shape, edge cases                                                      | `references/escalate-resume.md`              |
| Placeholder vocabulary, annotation grammar                                                                   | `references/placeholders-and-annotations.md` |
| Shared worker rules: spawn contract, idempotency, input resolution, write discipline, signalling, escalation | `references/worker-protocol.md`              |

Worker instructions live in `.claude/agents/plant-{planner,developer,
reviewer}.md`. Each agent opens by reading `references/worker-protocol.md`,
then its own role content. Workers read those themselves — you don't.

## Pipeline state on disk

State lives at `<worktree>/.plant/<branch>/`. Every artifact is a file a
replacement worker can read.

```
<worktree>/.plant/
  active                      single-pipeline lock; one line: branch name
  <branch>/
    workflow.md               7-field brief + stage checklist + annotations
    plan.md                   planner output (stage 1; absent for Size: small)
    decisions.md              auto-resolved gates: what was decided, what settled it, which doc or finding
    review-round-N.md         reviewer output per round (stage 3)
    events/
      <iso>-<kind>.md         escalation events
```

`active` is a per-worktree single-pipeline lock: `/plant` refuses to start
a second pipeline while one is in progress, so the user resumes or aborts
first. Separate worktrees run independent pipelines.

`.plant/` lives in the worktree root, never the main checkout. Workers
receive absolute paths in their opener and operate inside the worktree
themselves — there is no shell `cd` at spawn time.

## Personas

Four actors: you plus three workers. The user is an implicit fifth —
supplies the issue, answers the triage gate and escalation pages, and
either merges the PR or hands you the go-ahead to.

| Persona                                   | Lifetime        | Key responsibility                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orchestrator** (you)                    | the session     | Derive the brief from the artifact, run the triage gate, spawn workers, route signals, page the user, run the finish gate. Never does stage work.                                                                                                 |
| **Planner** (stage 1)                     | fresh per spawn | Brief → `plan.md` with a Tasks↔AC coverage table, grounded in 2–3 parallel `Explore` subagents and a named-agent plan reviewer. Skipped entirely on `Size: small`.                                                                                |
| **Developer** (stage 2 + every fix round) | fresh per round | Self-bootstraps the worktree (`pnpm install`). Initial: implements the plan, self-reviews, opens the draft PR. Fix-round: applies the internal reviewer's `fix` findings, one commit per finding, pushes.                                         |
| **Reviewer** (stage 3)                    | fresh per round | Internal review via `pr-review-toolkit` agents plus named agents scaled to the diff → `review-round-<k>.md`. Clean → flips stage 3 (PR stays draft). Dirty → annotates, no flip. Cap 3 rounds (1 for `Size: small`), then escalates `review_cap`. |

All three workers default to **sonnet** and die with your session.
`plant-developer` is dual-mode (`${MODE}` = `initial` or `fix-round`);
`plant-reviewer` is single-mode — its opener carries no `${MODE}`.

**Stage 1–3 workers escalate through disk**: write an escalation event,
send an `ESCALATING` message, self-idle. Auto-resolve within the brief's
Autonomy bounds if you can; page the user only when you can't. Either way,
append the event's `## Resolution` block and the `> RESOLVED` annotation
_before_ fresh-spawning under the next-numbered name with the decision in
the opener. `references/escalate-resume.md` has the full protocol;
`references/autonomy.md` has the ladder that decides which branch you're
on.

## Dispatch

Spawn every worker the same way — `Agent` with a unique `name`,
`subagent_type: plant-<role>` (each role is a named agent at
`.claude/agents/plant-<role>.md`, and that agent definition is the
worker's entire instruction set, so the role is carried by the agent type,
not by the opener), and a **thin opener** (~5 lines) as the prompt. The
agent declares `model: sonnet` in frontmatter as its default, so you don't
pass `model:` on a normal spawn; pass `model: opus` only when the user
calls out a PR that warrants it — the Agent tool's `model` param takes
precedence over the agent's frontmatter.

The opener carries only what the agent definition can't know:

```
You are the <role> for ${BRANCH}<, in ${MODE} mode, round ${ROUND}>.
<one ${VAR} = <absolute value> line per var the role needs>

<mode sentence, if dual-mode.> <pointer to the input findings file.>
Substitute the values above wherever your instructions reference ${VAR}.
```

Which vars each role needs:

| Role                  | Vars in the opener                                    |
| --------------------- | ----------------------------------------------------- |
| planner               | `BRANCH`, `PLANTDIR`, `WORKFLOW`                      |
| developer (initial)   | + `MODE`, `PR_URL` once known                         |
| developer (fix-round) | + `MODE`, `ROUND`, `PR_URL`, `REVIEW_FILE`            |
| reviewer              | `PLANTDIR`, `WORKFLOW`, `PR_URL`, `ROUND` (no `MODE`) |

Values are literal strings — absolute paths for the path-valued vars
(`PLANTDIR`, `WORKFLOW`, `REVIEW_FILE`), plain values for the rest
(`BRANCH`, `MODE`, `ROUND`, `PR_URL`) — with no `envsubst`, no shell
export, no expansion at spawn. Names come from
`references/placeholders-and-annotations.md`; briefs must not reference a
placeholder absent from that table.

**Names are never reused.** Each re-spawn of a role takes the next counter
value (`developer1` → `developer2`), because an idle teammate can't be
reliably killed and a live worker sharing a name with lingering zombies is
a routing ambiguity. Once a stage worker reports and idles, **treat it as
dead**: never message it again. A `shutdown_request` is best-effort
cleanup, not a kill — the handshake doesn't reliably complete, so idle
teammates linger harmlessly (holding no write pen) until `/exit`.

Single-writer-per-moment therefore comes from self-idle plus your
sequential dispatch, not from any kill. Full mechanics, including
retry/replace and why fresh-spawn is the only recovery path, are in
`references/spawn-details.md`.

## Scripts

Deterministic state transitions are scripted so they don't cost judgment
or context. Each prints JSON to stdout, sends errors to stderr, and
explains itself with `--help` (usage prose, not JSON). Exit codes: 0
success, 1 usage error, 2 state error, 3 lock conflict.

```
scripts/pipeline-init.sh   --worktree <abs> --branch <name> [--repo <owner/repo>] [--brief-file <path>]   # brief from file, else stdin
scripts/pipeline-status.sh --worktree <abs> [--branch <name>] [--annotations <n>]
scripts/pipeline-finish.sh --worktree <abs> [--branch <name>] --status completed|aborted [--note <text>]
```

- **`pipeline-init.sh`** takes the `active` lock atomically, creates
  `.plant/<branch>/events/`, and writes `workflow.md` — header, stage
  checklist, and annotations scaffold around the brief body (sections 1–7)
  you pipe in on stdin, or pass with `--brief-file <path>` — plus a
  scaffolded `decisions.md`. Prefer `--brief-file` for anything but a
  short brief body: it avoids quoting and heredoc hazards on a
  multi-section markdown payload. Prints `branch`, `plantdir`, `workflow`,
  `started`. Exits 3 if another pipeline holds the lock, 2 if this branch
  already has a `workflow.md` (the signal you meant to resume, not init).
- **`pipeline-status.sh`** (resume, mid-stage death, user status ask) is
  one JSON snapshot: `status`, `pr_url`, `plantdir`, `workflow`, `stages[]`,
  `current_stage` (derived from the first unchecked checkbox),
  `open_escalations[]`, `review_rounds`, `artifacts{plan,decisions}` (which
  state files exist), `events[]` (each with `resolved`), trailing
  `annotations[]`.
- **`pipeline-finish.sh`** flips `Status`, appends the closing annotation,
  releases the lock (only if it names this branch), and returns the
  summary numbers: `duration_seconds`, `duration_human`, `review_rounds`,
  `escalations{annotated,open,open_files[]}`, `events_total`,
  `lock_released`. Pass `completed` once the PR merges, `aborted` for a
  user abort or a closed PR.

The scripts own scaffolding only. The brief's _content_ is your judgment —
you still author that from the artifact.

## Orchestrator workflow

1. **Stage 0 — derive the brief.** `gh issue view <N> --json
title,body,comments,labels,url`. Derive the 7 fields per
   `references/brief.md`'s table — §1–3 from the issue body and its
   full comment thread, §4 from the repo (`pnpm validate` is the gate
   unless the issue says otherwise), §5 from `references/autonomy.md`'s
   defaults, §6 always `PR merged`, §7 `auto | ask` defaulting to `ask`.
   Read the whole thread before drafting §1–3 — a later comment can
   override the body. Then the triage gate: clear on what to build →
   proceed without waiting; ambiguous or self-contradictory about what
   to build → ask the user about exactly that, once, then proceed
   (`references/brief.md` § Stage 0). Don't re-litigate §4–7, which
   never come from the user.
2. **Branch + worktree.** Build `<type>/<issue-number>-<slug>` — `type` is
   `feat|fix|chore|docs` chosen from the nature of the change, the number is
   the GitHub issue, the slug comes from its title — then
   `git worktree add .worktrees/<branch> -b <branch>`.
3. **Initialize.** Pipe the derived brief body (sections 1–7) to
   `pipeline-init.sh --worktree <abs> --branch <name>` — it takes the
   lock, scaffolds the directory, and writes `workflow.md` +
   `decisions.md`. Print the derived brief to the user; do not wait for
   approval, per the triage gate in step 1.
4. **Spawn stage 1 (planner)** as `planner1` — this first named spawn
   forms the team. Wait for its message. For `Size: small`, skip the
   planner entirely: flip `- [ ] 1. Plan` → `- [x] 1. Plan` in
   `workflow.md` yourself (atomic rename, same write as the annotation)
   and append `> NOTE <iso> — orchestrator: stage 1 skipped (Size:
small); developer works from brief ACs`, then go to step 6. The box
   must be ticked because `pipeline-status.sh` derives `current_stage`
   from the first unchecked checkbox — an unticked stage 1 would make a
   resume re-enter at the planner.
5. **Route off each message, then spawn the next worker.** Classify the
   outcome (done / dirty / clean / escalating), dispatch, then spawn the
   next-numbered stage-1–3 worker. The reporter self-idles; leave it. On
   a bare `teammate-terminated`, use `pipeline-status.sh` to classify
   what completed.
6. **Stage 1 done** → spawn developer (stage 2 initial). When it reports
   the draft PR, populate `${PR_URL}`.
7. **Stage 2 done (draft PR open)** → spawn reviewer (stage 3 internal).
8. **Reviewer dirty** → read the round file's `## Summary` before
   dispatching; it says whether a fix round is the right response.
   Usually it is: fresh developer in fix-round mode, then a fresh stage-3
   reviewer (max 3 rounds; the reviewer escalates `review_cap` at the
   limit). If the summary diagnoses churn — findings introduced by the
   previous round's own fixes — another per-finding patch round reliably
   makes it worse; use the alternative in `references/escalate-resume.md`
   § Churn in internal rounds instead. Either way, carry the diagnosis
   into the next worker's opener — information left in the round file
   steers nobody. On `Size: small` the cap is one round, so a dirty round
   arrives as a `review_cap` escalation carrying the round file: page the
   user with the findings summary. Typical resolutions are one fix round
   plus a re-review, or accept as is, applied through the normal
   fresh-spawn-with-decision path.
9. **Reviewer clean** → it has already flipped stage 3. The PR is still a
   draft. Go to step 10.
10. **Stage 4 — the finish gate.**
    a. `gh pr ready <url>` — flip the draft to ready.
    b. Block on CI: `gh pr checks <url> --watch`, with an explicit
    `timeout` on the Bash call. Garden's CI runs typecheck, lint,
    format, and unit tests plus a build and a separate integration job
    that drives real tmux. `--watch` blocks on its own and is the
    preferred form; if you ever need a different wait, a bare
    foreground `sleep` is hard-blocked by the harness, so use
    `until <terminal-check>; do sleep N; done` instead.
    c. **CI red** → treat the failure as a finding: write it into a
    review-round file in the findings shape the developer's fix-round
    mode already expects (`Disposition: fix`, `Severity`, `Location`,
    `Issue`, `Failure scenario`) describing what CI reported, dispatch
    a developer fix-round against it, then re-check from (b).
    d. **CI green** → act on brief field 7. `ask` → report CI-green
    status to whoever is waiting on this pipeline — the local user, and
    the dispatching peer if the brief named one — and hand them the
    merge; the pipeline pauses here until step 12 confirms it. `auto` →
    `gh pr merge <url> --squash --delete-branch`; step 12's check is
    what tells you whether this succeeded, not the exit code. Default
    is `ask` — this is the one irreversible act in the pipeline, which
    is why field 7 is the explicit switch for it.
11. **Stage 1–3 escalation** → `references/escalate-resume.md`.
    Auto-resolve within the brief's Autonomy bounds if you can, otherwise
    page the user; append the event's `## Resolution` block and the
    `> RESOLVED` annotation, then fresh-spawn under the next name with the
    decision in the opener.
12. **Completion or abort — the shared convergence point for however the
    pipeline ends**, reached from step 10(d) once `gh pr view --json state`
    confirms `MERGED`, under every merge policy — neither of the
    two things that might otherwise stand in for that confirmation can
    be trusted. `gh pr merge --delete-branch`'s exit code lies when run
    from inside the worktree: its local post-merge step tries to switch
    to the default branch to free the feature branch for deletion, and
    that switch fails (the default branch is already checked out in the
    main checkout) even though the GitHub-side merge and remote branch
    deletion both went through. And a report that the PR merged, from
    the user or from a dispatching peer, is only a prompt to check it,
    not the confirmation itself — verifying against GitHub directly is
    what makes the reporter's identity irrelevant. Otherwise the
    pipeline closes without merging, or aborts at any earlier stage.
    a. **Merged only.** Read `decisions.md` and confirm every entry is
    reflected on the PR — its description, a commit, or a review thread.
    The PR is the only surface here that outlives the run; the summary
    you post to the user in (b) is chat, gone once the session ends, so
    it reports what (a) already put on the PR rather than carrying
    anything on its own. Add anything missing to the PR now — the last
    point it can still be edited.
    b. Run `pipeline-finish.sh --worktree <abs>
--status completed|aborted` — `completed` only once the PR has merged;
    `aborted` for a closed-without-merge report, or any earlier-stage
    abort — and summarize its JSON to the user: duration, review rounds,
    escalation counts, `decisions_entries`, and the PR URL. **Merged
    only:** cross-check `decisions_entries` against what (a) found
    reflected; a higher count than you accounted for means going back to
    cover the gap before moving on.
    c. **Merged only, from the main checkout, never from inside the
    worktree being removed:** `git -C <main-checkout> worktree remove
<abs>`, then `git -C <main-checkout> branch -D <branch>`, in that
    order. Removal must precede the branch delete — git refuses to
    delete a branch checked out in a linked worktree, from either
    checkout, failing with `cannot delete branch '<branch>' used by
worktree at <path>`. Running both via `git -C` from the main
    checkout, rather than from inside the worktree, also sidesteps the
    cwd reset that removing a worktree the shell is standing in causes —
    every command after that point would otherwise need an absolute
    path to recover. This is also why (b) runs before (c):
    `pipeline-finish.sh` reads and writes `.plant/<branch>/` inside the
    worktree it's about to lose.
    d. **Merged only.** `.plant/<branch>/` — `workflow.md`, `plan.md`,
    `decisions.md`, every `review-round-N.md` — is deleted with the
    worktree by design: once (a) has put what mattered onto the PR,
    nothing here needs to survive it.

    For an aborted pipeline, or a PR closed without merging, run only
    (b) with `--status aborted` and stop — leave the worktree and branch
    for the user, per the no-auto-rollback invariant; this step doesn't
    add cleanup behavior beyond what already applies.

**Mid-pipeline scope changes.** When a user decision changes scope, edit
the brief field in place and annotate — only between worker invocations,
never while one is running. See `references/brief.md` § Brief editing
mid-pipeline and § Mid-pipeline user concerns.

## Resume

`/plant resume` takes no branch argument. Run `pipeline-status.sh
--worktree <abs>` — it resolves the branch from the `active` lock file, so
there's nothing for the user to supply. Exit 2 is the generic state error;
it also fires on a `--worktree` path that isn't a directory, and on a lock
that names a branch whose `workflow.md` is missing, so report the script's
actual error text rather than assuming there's nothing to resume. Never
run `pipeline-init.sh` on a resume — the lock and `workflow.md` already
exist, so it exits 3 or 2 instead of doing anything; that exit is itself
the signal you should have resumed instead of initialized.

Before advancing the pipeline, resolve anything in the status output's
`open_escalations[]`: read that event file, page the user if the decision
isn't already recorded there, then append the event's `## Resolution`
block and the `> RESOLVED` annotation. A freshly spawned worker reads its
decision from that block, so an unresolved escalation left dangling means
the next spawn has nothing to act on.

Re-enter at the reported `current_stage` by fresh-spawning that stage's
worker. Worker counters restart at 1 in a new session — the old team died
with the old session, so there's no live `developer3` to collide with a
new `developer1` (`references/spawn-details.md` § Naming).

`current_stage: 4` means stages 1–3 are flipped, so the re-entry point is
the finish gate, not a stage worker — check `gh pr view --json
isDraft,state` and pick up at whichever of step 10's sub-steps the PR's
actual state implies (still draft → (a); ready with checks pending → (b);
checks failed → (c)). Stage 4's checkbox is never flipped by any worker —
`Status: completed | aborted` is the real completion signal, so a
`current_stage: 4` with `status: active` means the finish gate was
underway, not that stage 4 never started.

## Out of scope

- **A PR watcher.** The finish gate blocks on `gh pr checks --watch` inside
  your own turn. Nothing observes the PR on a timer, so there is no polling
  cadence to tune and no worker to shut down.
- **Cross-repo / multi-PR pipelines.** One issue, one PR, one pipeline.
- **Custom reviewer personas via brief.** The stage-3 reviewer picks named
  agents from diff character, not user config.
- **Approval count overrides.** Branch protection is the source of truth
  for who must approve and how many. If a repo's protection is too lax,
  fix it there, not with a brief field.
