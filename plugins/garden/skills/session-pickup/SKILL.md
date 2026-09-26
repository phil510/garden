---
name: session-pickup
description: >-
  Use when acting on inherited context written by an earlier session or another agent — the user
  @-references a `.handoffs/*.md` file (a bare reference with intent to continue is enough), or
  says "pick up where I left off", "pick this back up", "continue from this handoff", "resume from
  yesterday", "where was I", "here's the handoff from last session", or "keep going on this". Also
  use for inherited specs, plans, tickets, and design docs handed over as the basis for work —
  verification does not transfer spec→plan→code, so a plan derived from a verified spec still
  needs its own premise-check. Prefer running it whenever inherited context is present: the failure
  mode is undertriggering and spending an hour refining inside a stale frame. Consumes what
  `session-handoff` writes. This "pickup" is about resuming a written `.handoffs/*.md` context
  file — unrelated to garden's own `garden new --handoff` / `garden handoff --to` CLI verbs, which
  move swarm-lineage placement and write nothing to disk.
---

# Session Pickup

Inherited handoffs are snapshots. Named directions, mechanism claims, and cited memory entries can be stale by the time you read them — the writer based them on what they knew then, and the world may have moved. Check load-bearing premises _before_ refining within the frame, so a confidently-written stale claim doesn't drag this session into the wrong design.

When this pickup was triggered automatically — the running session was spawned by `garden new --handoff` and pointed at a handoff file — identify the session by `$GARDEN_SESSION_ID`, not any Claude-side session id: a prior `/clear` in the same pane may already have changed the latter.

## 1. Triage

Read the handoff and look for load-bearing markers — claims where removing them would change the plan:

- **Named direction** — "the preferred approach is X", "we decided Y"
- **Mechanism claim** — "X failed because Y", "fix Z addresses W"
- **Baseline assumption** — "test currently fails because…", "image is broken at…"
- **Cited memory entry** — `memory/*.md` references the next session is meant to lean on
- **Explicit `## Premises` section** — the writer flagged these themselves; treat as the curated list

If any are present → premise-check (step 2). If the handoff is plainly descriptive ("tests pass, continue with the next task") → step 3.

When in doubt, run the premise-check. A focused check is cheap; an hour of refining inside a stale frame is not.

## 2. Premise-check

Dispatch **one** subagent with all the load-bearing claims as a single checklist. Batching keeps the research weight in one transcript; one subagent per claim multiplies cost and fragments the verdicts. Use `using-subagents` to pick the named agent that fits what's being challenged.

Constrain what comes back — a tight return format is what keeps investigation out of the main session's context:

```
Input:  one checklist, each item = the claim verbatim + why it's load-bearing
Output: per claim —
          Status:      holds | contradicted | unverifiable
          Evidence:    one sentence
          Implication: one sentence, only when contradicted
        No research narrative; investigation stays in your transcript.
```

Shaping the dispatch prompt:

- Skip claims you can resolve from your own context without dispatching.
- For mechanism claims, ask what the mechanism predicts about other observations — logs, code, tests, primary docs. A confident causal chain with no falsifiable prediction is a tell that the writer never verified it end-to-end.
- Re-verify cited memory entries against primary sources, but only the ones the plan actually leans on. Chasing every passing reference is busywork that buys no protection.

## 3. Surface findings, then proceed

If premise-check ran, report briefly before doing the work the handoff asks for:

- **Holds** — note the evidence in one line, proceed.
- **Contradicted** — surface the contradiction and the alternative, then wait. The user owns the framing call with the contradicting evidence in hand; inverting a direction unilaterally trades their stale frame for yours.
- **Unverifiable** — flag as a known unknown. Ask whether to design around it or treat it as a blocker.

Then refine within the frame as the handoff intends.
