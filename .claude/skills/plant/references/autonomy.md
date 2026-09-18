# Autonomy

Every gate a worker hits collapses to the same question: resolve it here, or
page the user? This is what a worker reads to answer that, and what the
orchestrator reads when deciding what to do with an escalation.

## The rework-cost test

Don't size the decision — size what a wrong guess costs. Before escalating,
or before deciding not to, ask: **if I'm wrong about this, what gets thrown
away?**

- **Escalate now** when later work will assume the answer. A wrong guess here
  isn't corrected in place — it's discovered several files later, after other
  work is already built on top of it, and the fix is re-planning or
  re-implementing rather than editing a line.
- **Decide, log, continue** when the decision is contained: reversible inside
  the commit that made it, with nothing downstream depending on which way it
  went. Pick a reasonable interpretation, write down why, keep moving.

Stage is a decent proxy, because of _when_ each worker's output gets
consumed: a planner's ambiguity is load-bearing almost by construction (the
plan is what every later stage reads), while a reviewer's is usually
contained inside one finding, one round, one commit. But the proxy isn't the
rule — a developer decision late in a stage can still be load-bearing, like a
naming choice in commit 3 that commit 7 already imports. Judge the actual
dependency, not the stage label; that's what gets the exceptions right.

## Decide, log, continue

Contained by default:

- A planner or reviewer ambiguity the repo's own docs settle — the answer
  already exists, it just needed looking up.
- A planner ambiguity where the issue's objective still holds and only the
  _how_ is in question — the destination is fixed, the route is unclear.
- A developer verify failure, for up to three attempts with a genuinely
  different approach each time. One failed attempt is normal; three
  identical retries are stalling, not deciding (see below).

Resolve it, write the reasoning to `decisions.md`, and keep going.

## Hard stop — page the user, even unattended

Some situations don't have a contained interpretation to decide between, or
the cost of guessing wrong is high enough that guessing is itself the wrong
move:

- **Planner: work too large to decompose, or needs slicing.** There's no
  "pick one and log it" available — a plan that doesn't decompose isn't an
  ambiguous plan, it's not a plan yet, and deciding alone here means deciding
  the shape of everything downstream on a guess.
- **Reviewer: an acceptance criterion that costs more to satisfy than it's
  worth.** This reads like exactly the judgment call an autonomous worker
  should just make — which is precisely why it's a hard stop instead. An AC
  that turns out disproportionate wasn't costed by whoever wrote the issue;
  that's a gap in the understanding the work was scoped from, not a problem
  the reviewer closes by picking an outcome. Quietly building around it (or
  quietly satisfying it at high cost) erases the only signal that something
  was mis-scoped — surfacing it _is_ the correct resolution here, not a
  fallback for when a cleaner one can't be found.
- **Developer: `autonomy_exceeded` or `stall`.** An autonomy bound is a line
  the user drew on purpose, not the worker's to cross regardless of how
  contained it looks. A stall has no decision to log — more autonomy doesn't
  produce progress that wasn't happening.
- **Reviewer: `review_cap` still dirty at the round cap.** The cap exists
  because rounds were supposed to converge and didn't; continuing past it
  unattended is the failure it's there to catch, not something to paper over.
- **Anything that rewrites git history, touches anything outside the
  worktree, or can't be recovered from.** A bad decide-and-log is fixable by
  a later commit; a rewritten history or a change outside the sandbox the
  pipeline is trusted to touch isn't.

## `decisions.md`

Lives in the pipeline's state directory alongside `workflow.md` and the
`events/` log, append-only with the same discipline. Every gate that got
auto-resolved — decided rather than escalated — gets one line: what was
decided, what settled it, and which doc or finding backs it up.

It's what makes a run reviewable after the fact. Under low autonomy the user
sees each decision as it happens, because they're the one making it. Under
high autonomy nobody's watching in real time, so "it merged cleanly" proves
nothing about whether the choices along the way were sound — this file is
the record that lets the user check afterward instead of having watched.
Cite it in the final report; "3 auto-resolved, 0 escalated" with no pointer
here is the unauditable version of the thing this file exists to prevent.

A line reads like:

```
2026-09-12T14:03Z — planner: interpreted "the settings panel" as the existing
web/settings route, not a new one. docs/architecture.md's routing section
lists no other settings surface; issue body never says "new".
```

## Docs as the tie-breaker

Consult the repo's docs before escalating an ambiguity; escalate only if
they're silent too. A work ticket has nothing behind it but the ticket
itself — this repo has documentation written to answer exactly the kind of
question a worker runs into mid-stage.

- The docs index is the entry point — start there rather than guessing a path.
- The living docs are authority: they describe the system as it is right now
  and get updated in place, so layering, dependency rules, and how to write a
  test have real answers waiting there.
- Frozen specs are historical context, not authority — they capture a
  decision at the moment it was made and drift as the code moves past them.
  Good for _why_ something was built a certain way, not for whether it still
  works that way.

If the docs are silent on something they plainly ought to cover, that
silence is itself worth escalating — a better finding than the original
question, since it points at a gap the user can close for every future run.

## Default bounds for the brief

Stage 0 writes these into the brief's Autonomy bounds field unless the issue
calls for something narrower. This repo is a deliberate test bed for pushing
autonomous agents further than a work repo would allow, so the defaults run
wider than a production codebase would tolerate — but `Never:` holds
regardless of how far `Auto:` stretches:

**Auto:** installing dependencies, running the verify command and any test
tier, creating and pushing commits, opening and updating the draft PR,
resolving decide-log-continue ambiguities per the rework-cost test, iterating
on internal review rounds up to the cap.

**Ask first:** merging the PR (field 7's `merge policy` handles this
directly, default `ask`), touching files outside the issue's stated scope,
adding a new production dependency.

**Never:** rewriting git history, any change outside the pipeline's own
worktree, deleting or force-overwriting anything without a recovery path,
and touching the user's global Claude Code configuration.
