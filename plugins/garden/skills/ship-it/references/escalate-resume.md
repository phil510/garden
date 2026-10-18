# Escalation and resume

The universal pattern for worker-flagged ambiguity, autonomy violations, and unclassifiable cases.
The decision goes back to the worker that escalated, because it still holds the context the
decision applies to — the diff, the PR, its own findings — and rebuilding that in a fresh worker
costs a full re-read for nothing. Disk carries the decision first, so a fresh spawn can apply it
just as well when that worker is gone.

## Protocol

1. A worker hits ambiguity, an autonomy violation, or a can't-classify case. Before writing the
   event, it checks the project's living docs and any authority the brief names for an answer —
   most escalations exist because the brief can't settle a question the code raised, and the docs
   often can. It escalates only if they're silent too.
2. The worker writes `events/<iso>-escalation.md` and appends
   `> ESCALATED <iso> — <actor>: <reason>; see events/<iso>-escalation.md` to the end of
   `## Annotations`.
3. The worker sends `ESCALATING — see events/<iso>-escalation.md, decision needed on <X>`, then ends
   its turn and **waits**. It hasn't finished its stage and still holds the pen, so nothing else is
   dispatched while it waits, and it gets no `TaskStop` — it is the one who will apply the
   decision.
4. The orchestrator reads the escalation event, and the referenced `Artifact` if needed.
5. Can the orchestrator resolve it within `autonomy.md`'s ladder and the brief's §5 for this role
   and reason?
   - **Yes** → auto-resolve, and append a line to `decisions.md` in its shape (a bare ISO timestamp
     at column 0, then ` — orchestrator: <decision>`): what was decided, what settled it — a doc, a
     finding, the brief's surviving objective — and the escalation it closes. Without that line an
     unattended run is unauditable: "it merged" says nothing about the choices along the way.
   - **No** → page the user and collect a decision.

   `autonomy.md` holds the ladder — which reasons and roles may auto-resolve and which are hard
   stops. Both branches end the same way: message the escalator back. An escalator nobody messages
   never finishes its stage and keeps the pen, so an auto-resolve is not exempt.

   **Either way, disk first: append the `## Resolution` block to the event file and write the
   `> RESOLVED` annotation before messaging or spawning.** The decision has to survive the worker:
   if the session dies before the message lands, the replacement reads it from disk. The block's
   presence is also the only on-disk signal that the escalation is closed — `pipeline-status.sh`
   reports an escalation event without it as still open, so skipping it leaves the pipeline
   permanently escalated.

6. `SendMessage` the escalating worker by its existing name: the decision, a pointer to the event
   file, and "re-read the brief" if the resolution edited it. Reusing the name is safe because
   nothing else was dispatched during the pause, so the escalator is still the only writer.
7. The worker reads the `## Resolution` block (disk is authoritative; the message is the wake-up),
   applies the decision, completes the stage, and sends its normal report.
8. The orchestrator routes off that report and advances.

### Fallback: fresh-spawn

The escalator is **gone** in exactly two cases: the session is new (`/garden:ship-it resume` —
teammates don't survive the orchestrator's session, so nothing from before is live), or it
`teammate-terminated` without a result. Then spawn the role under the next-numbered name
(`spawn-details.md` § Naming) with the decision block in the opener and a pointer to the event file.
It rebuilds from `workflow.md` and the stage artifacts — which is why a waiting worker saves its
state before escalating — reads the same Resolution block, and completes the stage. This is the
same code path as post-crash recovery; the decision block is the only difference.

An external reviewer needs one more thing to land on the right work: `${EVENT_FILE}` set to the
activity file it escalated from (the escalation's `**Artifact:**`). Without it the reviewer runs a
fresh intake, finds every id already recorded, and reports `nothing-new` — dropping the decision.

`review_cap` needs no replacement reviewer. Its decision is another fix round or accepting the
round as is, and both are moves the orchestrator makes anyway: a fix round is SKILL.md's dirty path
on the escalated round file; accepting ticks stage 3 itself (one atomic write with
`> NOTE <iso> — orchestrator: stage 3 accepted with limitations per events/<iso>-escalation.md`)
and writes each accepted finding to `decisions.md`, since no reviewer is left to name them.

A worker that is merely **silent** after the decision message — an idle notification with no
report — is not gone. It may still write, and a replacement beside it would be a second writer, so
page the user instead of spawning. `/garden:ship-it resume` in a new session is the clean way past
it.

## Escalation event shape

Workers write the whole file — there is no orchestrator-populated metadata.

```markdown
# Event: escalation — <iso>

**Reason:** autonomy_exceeded | error | stall | ambiguity | review_cap | <short free text>
**Stage:** plan | dev | review
**Artifact:** <path to the stage artifact with full detail>
**One-liner:** <≤120 char summary>

## Details

<what happened, what was tried, what the docs said (or that they were silent)>

## Suggested options

- <option a>
- <option b>

### Generated IDs (reviewer)

(Reviewer only, when the escalated finding came from a comment or review — a check failure or
conflict has no thread to ack.)

- Ack reply: <reply_id>

---

## Resolution

(Appended by the orchestrator once decided — by auto-resolve or by the user)
**Resolved at:** <iso>
**Decision:** <option / free text>
**Rationale:** <optional note; on an orchestrator-accepted review_cap, the accepted findings>
**Applied via:** auto-resolve, logged to decisions.md | message to <worker name> | fresh-spawn as <worker name> | orchestrator (a review_cap carried out directly) — each `at <iso>`
```

The reason codes name the common cases, not the legal ones. When none fits — above all when the
evidence says the protocol's next move is the wrong one (a loop regressing instead of converging) —
escalate with a short free-text reason, the evidence, and a proposed alternative. Free-text
escalations route exactly like coded ones: check the ladder, auto-resolve if it permits, else page
the user.

## Who escalates

| Persona     | Escalation path                                                                                                                                                                                                             | Typical reasons                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Planner     | Event + `ESCALATING` → auto-resolve or user → decision messaged back                                                                                                                                                        | `ambiguity`, `error`                               |
| Developer   | Event + `ESCALATING` → auto-resolve or user → decision messaged back                                                                                                                                                        | `autonomy_exceeded`, `error`, `stall`, `ambiguity` |
| Reviewer    | Event + `ESCALATING` → auto-resolve or user → decision messaged back                                                                                                                                                        | `ambiguity`, `review_cap`                          |
| Review-loop | No event — an inline `escalating` message (`communication.md` § #2b); the orchestrator pages the user and replies, and the worker resumes in place. Its state lives in its own state file, so there is no Resolution block. | the item kinds in its `why:` line                  |

For `Size: small`, `review_cap` fires on the first dirty internal round — the cap is 1, not 3.

## Churn in internal rounds

A round file's `## Summary` diagnoses churn when the findings sit in text the previous round's
fixes wrote — severity (how bad the finding is if hit, a separate axis from whether it blocks)
holding or rising across rounds. Findings the reviewer marked `advisory` as unreachable are its
clean-with-limitations outcome and don't arrive here. Another per-finding patch round reliably
yields a narrower instance of the same defect: each fix is locally correct against one finding, and
nobody holds the whole region. Instead, give one author the whole affected region — a fresh
developer whose opener names the region, hands it the prior round files as the test suite its
rewrite must pass, and tells it to re-verify ground truth from source rather than from the previous
fixes. If the churn smells premise-level — the fixes contradict each other because the brief or
plan is ambiguous about what the region is for — page the user instead.

## Edge cases

- **User aborts during an escalation.** Send no decision; run the abort path. The waiting worker
  is stopped with the rest at finish (`spawn-details.md` § Stopping a worker).
- **The user's free text doesn't match any suggested option.** The worker reads `Decision` as free
  text and interprets it against the options and the brief.
- **A silent review-loop worker goes unnoticed (accepted).** Nothing detects it: the orchestrator's
  only timer is the backstop, whose result it forwards without expecting a reply, and an idle worker
  looks like a live one. The cost is delay, not corruption, and the recovery is
  `/garden:ship-it resume`. Silence after a forwarded digest is the case worth checking when the
  user asks why the pipeline has gone quiet.
- **Multiple escalations in one run.** Workers escalate one at a time; one event file per
  occurrence, each closed by its own Resolution block, so there is no cross-escalation state.
