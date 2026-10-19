# Communication mechanisms

Six named mechanisms cover every interaction in a ship-it pipeline. Each has one owner and one
direction. Worker agents reference them by number.

## #1 — Filesystem artifacts (worker ↔ worker, worker ↔ orchestrator)

- `workflow.md` — header, brief, stage checklist, append-only annotations.
- `decisions.md` — append-only log of auto-resolved gates and accepted limitations; copied into the
  PR body by the orchestrator.
- `plan.md` — planner output, developer input (initial mode).
- `review-round-<k>.md` — internal review output, developer input (fix-round mode).
- `events/<iso>-<kind>.md` — external event lifecycle, grown in place (`event-routing.md` § Event
  file lifecycle), and escalations.

Workers write; the orchestrator reads, and writes annotations, brief edits and its own
`decisions.md` lines. Atomic rename for every write.

**Single-writer-per-moment.** The orchestrator is the sole dispatcher, and only one worker holds a
write pen at any time: each worker self-idles after it reports, and the orchestrator spawns the
next only after the prior has reported. An escalating worker keeps the pen through the pause,
because nothing else is dispatched until it reports. The reviewer (external mode) creates each
event file on intake and appends its classification; the developer (fix-round) appends to that
same file afterwards.

## #2 — Worker-authored messages (worker → orchestrator, asynchronous)

Every worker is a teammate, and every worker reports with a typed `SendMessage`. There is no exit
code and no stdout file — the message body **is** the signal. This is the context-economy core of
the pipeline: the orchestrator routes off the message and reads disk only on demand, instead of
reading `workflow.md` and `events/` on every hop.

1. **Write-then-signal.** The worker finishes its disk writes, _then_ sends its message, so disk is
   consistent before the orchestrator can act.
2. **The message carries the routing summary**, in the shapes fixed by SKILL.md's Contract § Worker
   reports — enough for the orchestrator to pick the next dispatch without reading disk.
3. **The orchestrator routes off the message.** It reads disk only when it needs detail it chose
   not to inline, or when a high-stakes hop warrants verification — the ready flip, the merge,
   pipeline completion, or a contradictory signal.
4. **Detail goes to the consumer, not through the orchestrator.** Per-finding dispositions live in
   the review or event file, which the _next worker_ reads. The orchestrator needs only the counts.
5. **Disk remains the resume source.** Messages are ephemeral. A fresh orchestrator after session
   death, or a fresh worker, rebuilds entirely from disk.

**Why this doesn't violate "verify before trust."** Trusting a worker's report of _its own
just-completed actions_ is a low-risk class — the worker knows what it did, and consequences surface
downstream anyway. That is distinct from trusting an agent's claims about code behaviour, which the
workers still verify. The irreversible hops — the ready flip and the merge — re-check GitHub
directly rather than trusting any report.

### #2 crash fallback — bare termination → disk-read

If a worker dies after a disk write but before its message, the orchestrator sees only a
`teammate-terminated` notification with no preceding result. It then runs
`${SKILLDIR}/scripts/pipeline-status.sh` to classify what the worker completed. The message is the
steady-state fast path; disk is the always-correct fallback.

### #2b — Review-loop payload kinds

The review-loop worker is long-lived and **messaged back in place**, never fresh-spawned while it is
live. It sends three kinds; SKILL.md says how the orchestrator handles each.

**triggered** — it posted a re-review trigger:

```
triggered: round <n>
bot: <bot key> (<bot login>)   trigger_ts: <the trigger comment's created_at>
```

The orchestrator starts the loop skill's backstop in the background when one exists (Contract
§ Review-loop outcome) and forwards its exit code and output when it exits. Between triggers the
worker idles; the orchestrator also forwards it every non-terminal digest (#6).

**escalating** — a mid-loop item the loop skill won't auto-fix:

```
escalating: <one-line description of the item>
why: architectural | security | heavy-lift | preference
context: <comment id, file/line, what the bot flagged, options>
```

The orchestrator pages the user and replies with the decision in free prose; the worker resumes.
`why:` classifies the kind of loop item — it is unrelated to an escalation event's `Reason:`, which
this worker never writes.

**done** — terminal:

```
done: passed | blocked
reason: <the loop skill's terminal condition, or why it couldn't run>
bot: <bot key | none>   rounds: <n>   declined: <n>
```

The worker writes `outcome` and `phase: done` to `review-loop-state.json` before sending it. The
orchestrator records the outcome NOTE and moves on to the ready flip or, on `blocked`, to the user.

The review-loop worker never writes `workflow.md`.

## #3 — The decision back to the escalating worker (orchestrator → worker)

Stage workers only; the review-loop worker surfaces through #2b instead.

The orchestrator writes the decision to disk first — the event's `## Resolution` block and the
`> RESOLVED` annotation, plus a `decisions.md` line when it auto-resolved — then `SendMessage`s it
to the escalating worker under its existing name. The worker reads the Resolution block (disk is
authoritative, the message is the wake-up) and continues its stage in place.

When that worker is gone (a new session, or a bare termination), fresh-spawn the role under the
next-numbered name with the same block in the opener — unless it escalated `review_cap`, which the
orchestrator carries out itself (`escalate-resume.md`). This works because every worker is
idempotent: a fresh one reconstructs everything from `workflow.md` and the stage artifacts.

Decision block, sent as the message or pasted into the fresh-spawn opener:

```markdown
# Resolution for escalation <iso>

**Decision:** <option from the worker's Suggested options, or free text>
**Rationale:** <optional clarification>

Read the Resolution block in events/<iso>-escalation.md, apply the decision, and complete your
stage per your agent instructions.
```

Add "re-read the brief" when the resolution edited it.

## #4 — PR-thread replies (worker → PR conversation)

Workers own PR voice. The orchestrator writes to the PR only for the ready flip, the PR-body copy of
`decisions.md`, and the merge.

A reply closes the loop with whoever commented, so replies belong to findings that came from a
comment or review thread. A failed check or a merge conflict has nobody waiting on an answer: its
outcome lives in the event file, and the fix commit shows on the PR by itself.

- **Reviewer** (`decline` and `escalate` on a comment or review): posts a reply before reporting
  and records its `reply_id`. Does **not** resolve the conversation — the human decides. A
  `decline` gives a substantive reason citing the brief; an `escalate` gives a short ack that the
  comment is being routed to the owner.
- **Developer** (`fix` on a comment or review): after commit and push, replies with the commit sha,
  resolves an inline conversation, and records both `reply_id` and `commit_sha`.

**Thread ids are derived at the point of use, not plumbed.** Replying needs only the numeric REST
review-comment id. Resolving is GraphQL-only and needs a `PullRequestReviewThread` node id, which
neither `gh pr view` nor a REST comment listing returns — a review comment's REST `node_id` is the
comment's, not its thread's. The developer looks it up itself at resolve time by walking the PR's
review threads and matching `fullDatabaseId`, as its agent definition's fix-round mode describes.

**Tone floor.** Brief, professional, factual. State what was done or why it won't be done. No
apologies, filler, or emoji.

## #5 — User dialogue (orchestrator ↔ user, synchronous)

Only the orchestrator talks to the user. Workers never do. Page in plain text — an options widget
may not render the surrounding context.

- **Triage gate.** Input clear on what to build → print the derived brief and start; ambiguous about
  what to build, or the user asked to see the brief → ask about exactly that, once (`brief.md`
  § The triage gate).
- **Escalation pages.** Render the escalation event's one-liner, options and artifact pointer; wait;
  translate the answer into a decision block (`escalate-resume.md`).
- **Review loop blocked.** Say what the loop couldn't clear (the state file's `reason`) and ask
  whether to flip the PR to ready anyway or stop.
- **Merge page** (`Merge policy: ask`, or `auto` on a repo with no CI). Once the PR is
  merge-eligible, say so with the head sha and what eligibility rested on, and ask to merge.
- **Every other page** (escalations, review loop blocked, reviewer comments needing the user's call,
  breakage only the user can fix) follows the general repeat rule in the `alert` skill.
  Re-check eligibility after the answer — the PR may have moved while you waited.
- **Mid-pipeline questions.** Run `${SKILLDIR}/scripts/pipeline-status.sh` and render a digest from
  its JSON. Never pull raw worker output into your context.
- **Completion summary.** Duration, round count, escalation counts, `decisions_entries`, PR URL, and
  any **Unrouted at stop** entries — returned by `${SKILLDIR}/scripts/pipeline-finish.sh`.

## #6 — PR-watch digests (garden → orchestrator)

After internal review comes back clean, the orchestrator subscribes its own session to the PR with
`garden watch`, and garden delivers one `Monitor event:` line per batch of PR activity. The line is
a pointer: the orchestrator routes off it without reading GitHub, and whoever gets the line does the
reading — the review-loop worker while the loop runs, a fresh reviewer otherwise. Routing:
`event-routing.md` § Digest routing. Mechanics: the `watch-pr` skill.

The watch's default kinds don't report checks that pass, so a digest never says "the PR is now
mergeable". That is what the checks wait in `event-routing.md` is for.
