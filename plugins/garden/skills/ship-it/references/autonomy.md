# Autonomy

Every gate a worker hits collapses to the same question: resolve it here, or page the user? This is
what a worker reads to answer that, and what the orchestrator reads when deciding what to do with
an escalation.

Two things are kept apart here. **Ambiguity handling** — when to decide and when to ask — is this
skill's to define. **Permitted side effects** — what may happen outside the worktree — belong to
the project and the user, through the instructions Claude Code injects; this file only sets the
floor.

## The rework-cost test

Don't size the decision — size what a wrong guess costs. Before escalating, or before deciding not
to, ask: **if I'm wrong about this, what gets thrown away?**

- **Escalate now** when later work will assume the answer. A wrong guess here isn't corrected in
  place — it's discovered several files later, after other work is built on top of it, and the fix
  is re-planning or re-implementing rather than editing a line.
- **Decide, log, continue** when the decision is contained: reversible inside the commit that made
  it, with nothing downstream depending on which way it went. Pick a reasonable interpretation,
  write down why, keep moving.

Stage is a decent proxy, because of _when_ each worker's output is consumed: a planner's ambiguity
is load-bearing almost by construction (the plan is what every later stage reads), while a
reviewer's is usually contained inside one finding, one round, one commit. But the proxy isn't the
rule — a developer's naming choice in commit 3 that commit 7 already imports is load-bearing too.
Judge the actual dependency, not the stage label.

## Decide, log, continue

Contained by default:

- A planner or reviewer ambiguity the project's docs settle — the answer already exists, it just
  needed looking up.
- A planner ambiguity where the brief's objective still holds and only the _how_ is in question —
  the destination is fixed, the route is unclear.
- A developer verify failure, for up to three attempts with a genuinely different approach each
  time. One failed attempt is normal; three identical retries are stalling, not deciding.

Resolve it, write one line to `decisions.md`, and keep going.

## Hard stop — page the user, even unattended

Some situations have no contained interpretation to pick between, or guessing wrong costs enough
that guessing is itself the wrong move:

- **Planner: work too large to decompose, or needs slicing.** A plan that doesn't decompose isn't
  an ambiguous plan, it's not a plan yet, and deciding alone here decides the shape of everything
  downstream on a guess.
- **Reviewer: an acceptance criterion that costs more to satisfy than it's worth.** This reads like
  exactly the judgment call an autonomous worker should make — which is why it's a hard stop. An AC
  that turns out disproportionate wasn't costed by whoever wrote it; quietly building around it, or
  quietly paying for it, erases the only signal that the work was mis-scoped. Surfacing it _is_ the
  resolution.
- **Developer: `autonomy_exceeded` or `stall`.** An autonomy bound is a line the user drew on
  purpose, not the worker's to cross however contained it looks. A stall has no decision to log —
  more autonomy doesn't produce progress that wasn't happening.
- **Reviewer: `review_cap` still dirty at the round cap.** The cap exists because rounds were
  supposed to converge and didn't; continuing past it unattended is the failure it's there to
  catch.
- **Anything that rewrites git history, has a side effect outside the worktree that §5
  doesn't permit, or can't be recovered from.** A bad decide-and-log is fixable by a later commit;
  a rewritten history or an unsanctioned change outside the pipeline's sandbox isn't.

## `decisions.md`

Lives in `${SHIPITDIR}` beside `workflow.md`, append-only with the same atomic-rename discipline.
Every gate that was auto-resolved rather than escalated gets one line, and so does every limitation
the reviewer accepted: what was decided, what settled it, and which doc or finding backs it.

It's what makes an unattended run reviewable afterwards. When the user is watching, they see each
decision because they're making it. When nobody is, "it merged cleanly" proves nothing about
whether the choices along the way were sound — this file is the record that lets the user check
afterwards instead. The orchestrator copies it into the PR body before the ready flip, and again
before merging if it changed, because the PR is the surface that outlives the run.

A line starts at column 0 with a bare ISO timestamp:

```
2026-09-12T14:03:00Z — planner: interpreted "the settings panel" as the existing settings route,
not a new one. The architecture doc lists no other settings surface; the issue never says "new".
```

## Docs as the tie-breaker

Consult the project's docs before escalating an ambiguity; escalate only if they're silent too. A
work item has nothing behind it but itself, while a project usually has documentation written to
answer exactly the questions a worker runs into mid-stage.

- Start from the living docs the project's injected instructions name — the ones described as
  current truth, updated in place. They're authority: layering, dependency rules and test
  conventions have real answers there.
- Frozen specs and design records are context, not authority. They capture a decision at the
  moment it was made and drift as the code moves on — good for _why_ something was built a certain
  way, not for whether it still works that way.

If the docs are silent on something they plainly ought to cover, that silence is worth escalating
— a better finding than the original question, since it points at a gap the user can close for
every future run.

## Default bounds for the brief

Intake writes these into §5 unless the input calls for something narrower. The injected
instructions may widen `Auto:` for side effects outside the worktree (a sandbox deploy, a
prerelease publish); they can't remove the `Ask first:` floor on production.

**Auto:** installing dependencies and authenticating as the injected instructions describe, running
the verify command and any test tier, creating and pushing commits on the pipeline branch, opening
and updating the draft PR, resolving decide-log-continue ambiguities per the rework-cost test,
iterating internal review rounds up to the cap, side effects outside the worktree that the injected
instructions permit.

**Ask first:** merging the PR (§7 decides this directly — `ask` pages, `auto` merges), touching
files outside the brief's stated scope, adding a new production dependency, production deploys and
stable releases whatever the instructions say elsewhere.

**Never:** rewriting git history, side effects outside the worktree that the
injected instructions don't permit, deleting or force-overwriting anything without a recovery path,
editing the user's own Claude Code configuration.
