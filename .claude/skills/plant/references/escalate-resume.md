# Escalation + resume

The universal pattern for handling worker-flagged ambiguity, autonomy
violations, or unclassifiable cases. There are two paths, and which one
applies depends on whether the escalating worker is still alive. The
primary path is **message-back**: the worker pauses mid-stage, still
holding the pen, and the decision is sent to it so it continues with its
context intact. The fallback is **fresh-spawn**: when the worker is gone,
a new one rebuilds from disk, which works because briefs are idempotent.

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
needed on <X>` `SendMessage`, then ends its turn and **waits**. It has
   not finished its stage and still holds the pen, so nothing else is
   dispatched while it waits.
4. Orchestrator reads the escalation event (and, if needed, the
   referenced `Artifact`). The waiting worker is not dead and gets no
   `shutdown_request` — it is the one who will apply the decision.
5. Can the orchestrator auto-resolve within `autonomy.md`'s bounds for
   this role and reason?
   - **Yes** → auto-resolve, and append a line to `decisions.md`: what
     was decided, what settled it (a doc, a finding, the issue's
     surviving objective), and the escalation it closes. This is what
     makes an unattended run reviewable after the fact — without it,
     "it merged" is unauditable.
   - **No** → page the user and collect a decision.

   Both branches end the same way: message the escalator back. An
   escalator nobody messages never finishes its stage and keeps the pen,
   so an auto-resolve is not exempt just because no user was involved.

   See `autonomy.md` for which reasons and roles auto-resolve versus
   hard-stop — the ladder lives there, not here.

   **Either way, disk first: append the `## Resolution` block to the
   event file and write the `> RESOLVED` annotation before messaging or
   spawning.** The decision has to survive the worker — if the session
   dies before the message lands, the replacement reads it from disk. The
   block's presence is also the only on-disk signal that the escalation is
   closed: `pipeline-status.sh` reports an escalation event without it as
   still open, so skipping it on the user-decision path leaves the worker
   nothing to read and the pipeline permanently escalated. On the
   auto-resolve path, the `decisions.md` line _is_ the record of what was
   decided — the event's `## Resolution` block still gets written so the
   escalation closes on disk the same way.

6. `SendMessage` the escalating worker by its existing live name: the
   decision text plus a pointer to the event file, and a request to
   re-read the brief if the resolution edited it. Reusing the
   name is safe because nothing else was dispatched during the pause, so
   the escalator is still the only writer.
7. The worker reads the `## Resolution` block (disk is authoritative; the
   message is the wake-up), applies the decision to the escalated point,
   completes the stage, and sends its normal result message.
8. Orchestrator routes off that message and advances to the next stage.

### Fallback: fresh-spawn

The escalator is **gone** in exactly two cases: the session is new
(`/plant resume`), or it `teammate-terminated` without a result. Then
fresh-spawn the role via `Agent` under the next-numbered name (§
spawn-details.md Naming), with the decision block in the opener plus a
pointer to the event file, and record the new live name in workflow
state. The new worker rebuilds from `workflow.md` + stage artifacts, which
is why a waiting worker saves its state to disk before escalating.
Fresh-spawn-with-decision is the same code path as post-crash recovery;
the only difference is the decision block in the opener.

A worker that is merely **silent** after the decision was sent — an idle
notification arrives with no result message — is not gone. It may still
write, and a replacement beside it would be a second writer, so page the
user instead of spawning; `/plant resume` in a new session is the clean
way past it.

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
**Applied via:** auto-resolve, logged to decisions.md | message to <worker name> | fresh-spawn as <worker name> — each `at <iso>`
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

| Persona   | Escalation path                                                              | Typical reasons                                    |
| --------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| Planner   | Event + `ESCALATING` message → auto-resolve or user → decision messaged back | `ambiguity`, `error`                               |
| Developer | Event + `ESCALATING` message → auto-resolve or user → decision messaged back | `autonomy_exceeded`, `error`, `stall`, `ambiguity` |
| Reviewer  | Event + `ESCALATING` message → auto-resolve or user → decision messaged back | `ambiguity`, `review_cap`                          |

For `Size: small`, `review_cap` fires on the first dirty internal review
round rather than at round 3 — the cap is 1, not 3.

A reviewer escalating `review_cap` is messaged back like any other
escalator. It records the decision and reports; it does not run the fix.
The orchestrator routes off that report — for a decision of "one more
round" it dispatches a developer fix round.

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

- **User aborts during escalation.** No message, no spawn; run the abort
  flow. The escalator is waiting, not dead, and lingers harmlessly once
  the pipeline is aborted.
- **User's free-text doesn't match any suggested option.** The message
  carries the free-text `Decision` too, and the worker (woken or freshly
  spawned) interprets it against the options and the brief. Briefs say so
  explicitly.
- **Multiple escalations in one run.** Workers escalate one at a time;
  one event file per occurrence. A live worker may escalate again in
  place, and each escalation is closed by its own `## Resolution` block,
  so there is no cross-escalation session state to carry.
