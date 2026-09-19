# Escalation + fresh-spawn

The universal pattern for handling worker-flagged ambiguity, autonomy
violations, or unclassifiable cases. There is **one** recovery path —
fresh-spawn — because briefs are idempotent and teammates have no resume
primitive.

## Protocol

1. Worker hits ambiguity, an autonomy violation, or a can't-classify
   case. Before writing the event, it checks the repo's living docs
   (`docs/architecture.md`, `docs/testing.md`, others as they join) for
   an answer — most escalations exist because the brief can't settle a
   question the code raised, and the docs often can. Escalate only if
   they're silent too.
2. Worker writes `events/<iso>-escalation.md` and appends
   `> ESCALATED <iso> — <actor>: <reason>; see events/<iso>-escalation.md`
   to the end of `workflow.md`'s `## Annotations` section.
3. Worker sends an `ESCALATING — see events/<iso>-escalation.md, decision
needed on <X>` `SendMessage`, then self-idles.
4. Orchestrator reads the escalation event (and, if needed, the
   referenced `Artifact`). The escalating worker is left idle — treat it
   as dead; a `shutdown_request` to it is optional best-effort cleanup.
5. Can the orchestrator auto-resolve within `autonomy.md`'s bounds for
   this role and reason?
   - **Yes** → auto-resolve, and append a line to `decisions.md`: what
     was decided, what settled it (a doc, a finding, the issue's
     surviving objective), and the escalation it closes. This is what
     makes an unattended run reviewable after the fact — without it,
     "it merged" is unauditable. (No re-spawn needed if nothing more
     must run; otherwise fresh-spawn to continue.)
   - **No** → page the user and collect a decision, then **fresh-spawn**
     the role via `Agent` under the next-numbered name (§ spawn-details.md
     Naming), with the decision block in the opener plus a pointer to the
     escalation event file. The orchestrator records the new live name in
     workflow state.

   See `autonomy.md` for which reasons and roles auto-resolve versus
   hard-stop — the ladder lives there, not here.

   **Either way, append the `## Resolution` block to the event file and
   write the `> RESOLVED` annotation before spawning.** That block is
   where the fresh worker reads the decision, and its presence is the only
   on-disk signal that the escalation is closed — `pipeline-status.sh`
   reports an escalation event without it as still open, so skipping it on
   the user-decision path leaves the worker nothing to read and the
   pipeline permanently escalated. On the auto-resolve path, the
   `decisions.md` line _is_ the record of what was decided — the event's
   `## Resolution` block still gets written so the escalation closes on
   disk the same way.

6. The fresh worker reconstructs state from `workflow.md` + stage
   artifacts, applies the decision, completes the stage, and sends its
   result message.
7. Orchestrator routes off that message and advances to the next stage.

A fresh-spawn-with-decision is the _same_ code path as post-crash
recovery: in both cases a new teammate rebuilds from disk. The only
difference is the decision block in the opener.

## Escalation event shape

Workers write the whole file — there is no orchestrator-populated
resume metadata (no session UUID exists to record).

```markdown
# Event: escalation — <iso>

**Reason:** autonomy_exceeded | error | stall | ambiguity | review_cap | <short free text>
**Stage:** plan | dev | review
**Artifact:** <path to stage artifact with full detail>
**One-liner:** <≤120 char summary>

## Details

<prose: what happened, what was tried, what the docs said (or that they were silent)>

## Suggested options

- <option a>
- <option b>
- <option c>

---

## Resolution

(Appended by the orchestrator once resolved — by auto-resolve or by the user)
**Resolved at:** <iso>
**Decision:** <option letter / free-text>
**Rationale:** <optional note>
**Applied via:** auto-resolve, logged to decisions.md | fresh-spawn at <iso>
```

The reason codes name the common cases, not the legal ones. When none
fits — above all when the evidence says the protocol's next move is
the wrong move (a loop regressing instead of converging) — escalate
with a short free-text reason, the evidence, and a proposed
alternative. The enumeration makes routing fast; it doesn't define
away situations it didn't anticipate, and a worker that follows
protocol into a failure it can see coming costs more than any
escalation. Free-text escalations route exactly like coded ones:
check `autonomy.md`'s bounds first, auto-resolve if they permit it,
else page the user.

## Who escalates

| Persona   | Escalation path                                                          | Typical reasons                                    |
| --------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| Planner   | Event + `ESCALATING` message → auto-resolve or fresh-spawn with decision | `ambiguity`, `error`                               |
| Developer | Event + `ESCALATING` message → auto-resolve or fresh-spawn with decision | `autonomy_exceeded`, `error`, `stall`, `ambiguity` |
| Reviewer  | Event + `ESCALATING` message → auto-resolve or fresh-spawn with decision | `ambiguity`, `review_cap`                          |

For `Size: small`, `review_cap` fires on the first dirty internal review
round rather than at round 3 — the cap is 1, not 3.

## Churn in internal rounds

A round file's `## Summary` diagnoses churn when the findings sit in
text the previous round's fixes wrote — severity holding or rising
across the rounds; falling severity is the reviewer's
clean-with-limitations outcome and does not arrive here. Another
per-finding patch round reliably yields a narrower instance of the same
defect: each fix is locally correct against one finding, and nobody
holds the whole region. Instead of a fix round, give one author the
whole affected region — a fresh developer whose opener names the region,
hands it the prior round files as the test suite its rewrite must pass,
and tells it to re-verify ground truth from source rather than from the
previous fixes. If the churn smells premise-level — the fixes contradict each other
because the brief or plan is ambiguous about what the region is for —
page the user instead.

## Edge cases

- **User aborts during escalation.** No re-spawn; run the abort flow.
  The escalating worker is already idle (treat as dead); it lingers
  harmlessly until `/exit`.
- **User's free-text doesn't match any suggested option.** The fresh
  worker reads `Decision` as free text and interprets it. Briefs say so
  explicitly.
- **Multiple escalations in one run.** Workers escalate one at a time;
  one event file per occurrence. Each is handled by auto-resolve or a
  fresh spawn, so there is no cross-escalation session state to carry.
