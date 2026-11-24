# Brief

The brief lives in `workflow.md` and is the single source of truth for every worker. Its shape —
four header fields and seven sections — is fixed in SKILL.md's Contract § Brief; this file covers
how to derive it, how to edit it mid-pipeline, and how to treat a user's mid-pipeline concern.

`${SKILLDIR}/scripts/pipeline-init.sh` writes `workflow.md` around the brief body you hand it
(prefer `--brief-file`; a multi-section markdown payload on stdin invites quoting accidents). It
supplies the header, stage checklist, annotations scaffold and `decisions.md`. Hand-write the file
only if the script can't run.

## Intake — deriving the brief

`/garden-claude:ship-it <ref | free text>`. The brief is derived, not negotiated: §1–3 come from the input,
the header fields and §4–7 from the project and `autonomy.md`.

- **A ref** is whatever tracker the project uses — a GitHub issue number or URL, a Jira key, a
  Linear id. Read it with the tools the session has (`gh issue view <n> --json
title,body,comments,labels,url` for a GitHub issue; whatever connector or CLI the session offers
  for another tracker). Read the whole comment thread before drafting §1–3: a later comment can
  contradict, narrow, or supersede the body, and the body carries no extra authority for having
  been written first. If no available tool can read the ref, say so and ask for the text — don't
  draft from the ref's title alone.
- **Free text** becomes §1–3 directly, and `Tracker` is `none`.

| Field                                          | Source                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Tracker`                                      | the ref exactly as the tracker writes it, or `none`                                                           |
| `Review loop`                                  | a review-loop skill the injected instructions name for this repo, else `none`                                 |
| `Spec`                                         | a design spec the input points at, else `none`                                                                |
| `Size`                                         | `small` when the input reads that way (below), else `standard`                                                |
| 1. Objective, 2. Scope, 3. Acceptance criteria | the input — for a ref, its body and full comment thread                                                       |
| 4. Verify command                              | the injected instructions; failing that, the repo's own script roster (`package.json`, `Makefile`, CI config) |
| 5. Autonomy bounds                             | the defaults in `autonomy.md`, narrowed if the input calls for it                                             |
| 6. Stop conditions                             | `PR merged`                                                                                                   |
| 7. Merge policy                                | `ask`, unless the user said `auto`                                                                            |

When `Spec` is set, §3 may be omitted — the planner derives ACs from the spec into `plan.md` — and
§1–2 may point at the spec rather than restate it. §4–7 stay required regardless: a spec is
consumer-agnostic and never carries pipeline fields.

`Size: small` means the change is known file-by-file before starting, fits in a commit or two, and
involves no design decision — a few-line code change, a config value, a dependency bump. It still
needs §1–7: the ACs become the developer's task list in place of a plan, so they must be concrete.

### Conventions come from injected instructions

Branch name, commit and PR format, the verify command, dependency install and auth, worktree
location — all of these follow the instructions Claude Code already injects into this session and
every worker. Don't ask the user for them and don't restate them in the brief beyond §4.

Where nothing covers a convention, one default applies: branch `<type>/<ref>-<slug>` (type from the
nature of the change, the ref as the tracker writes it, or omitted with `Tracker: none`), and the PR
closes or links the ref in whatever form the tracker recognises. The default covers formatting only.
It never invents a tracker identity, validation evidence, or authorisation the instructions don't
grant.

Worktree, when nothing says where: `git worktree add .worktrees/<branch> -b <branch>` from the main
checkout. If `git -C <main checkout> check-ignore -q .worktrees` fails, tell the user in one line
that `.worktrees/` isn't ignored there — don't write an ignore file outside the worktree to fix it.

### The triage gate

Inputs vary in quality, so the gate isn't whether this one is good — it's whether it answers _what
to build_ without you supplying the answer:

- Clear on what to build → write `workflow.md`, print the derived brief, and start. Confirming a
  brief that merely transcribed a well-written input buys nothing.
- Ambiguous or self-contradictory about what to build → ask the user about exactly that, once, then
  start. Silence where §1–3 need an answer counts, and so does a comment pulling against the body.
- The user asked to see the brief first → show it and wait.

The line is _what_ versus _how_. The user decides what gets built, so a gap there is theirs to
close; how to build it is yours and the planner's. Ask rather than resolve a _what_ gap plausibly:
an assumption at intake is the most expensive kind, because everything downstream inherits it.

Don't re-derive the header fields or §4–7 from the user; they come from the project and
`autonomy.md` regardless of input quality.

## Write discipline

`workflow.md` is append-only and written by atomic rename: read, append, write `workflow.md.tmp`,
then `mv workflow.md.tmp workflow.md`. A crash mid-write leaves an orphan `.tmp` rather than a
truncated `workflow.md`, which matters because every fresh worker rebuilds its state from this
file. Never rewrite or delete a prior annotation.

On stage success, a worker flips its checkbox `- [ ]` → `- [x]` in the same atomic write as its
final `> NOTE`, so nobody sees a completed stage without its annotation. Annotation kinds are fixed
— `placeholders-and-annotations.md` § Annotation grammar.

## Brief editing mid-pipeline

When a user resolution changes scope:

1. Edit the brief field in place with the `Edit` tool.
2. Append an audit annotation, flat at the end of `## Annotations`:
   ```
   > RESOLVED <iso> — orchestrator: edited AC3 per user decision in escalation <iso>;
   >   was "add a retry to the uploader" → now "surface the upload error instead"
   ```
3. If the edit invalidates a prior artifact (`plan.md`, a review round), append a matching
   annotation noting it. Staleness is the brief edit's ISO against the artifact's timestamp — no
   version counter. Fresh-spawn the affected stage with the new brief, unless the change is a small
   edit, which § Mid-pipeline user concerns routes on its own. The other exception is a worker
   waiting on this very escalation: it still holds the pen, so it is not replaced; it re-reads the
   brief when the decision message arrives.

Scope changes narrow as often as they grow. An AC that has run past a short paragraph has usually
absorbed implementation detail that belongs in `plan.md` or the code, and every extra clause is one
more rule a later fix can contradict. When a resolution narrows scope, cut the AC down rather than
appending qualifiers.

Pivots — the user replacing a requirement rather than adjusting it — are rare and costly when
handled as edits. Hold at the next worker boundary and dispatch nothing until the replacement is
settled: every worker spawned on a half-decided requirement builds code the next decision deletes.
Then rewrite everything in the brief the old requirement reaches, not just the sentence carrying
the new answer — a stale AC beside an annotation gives the next worker two instructions to choose
between. Say whether the old code is deleted now or kept for compatibility, after checking what
still calls it. Invalidate affected artifacts per step 3.

The orchestrator edits the brief only **between worker invocations** — at an escalation pause or a
stage boundary, never while a worker is running, since single-writer-per-moment extends to the
brief. An escalation pause counts as between invocations: the edit lands on disk before the
decision message, and the message tells the escalator to re-read the brief.

**Workers never edit the brief.** It belongs to the user; the orchestrator is the user's proxy.

## Mid-pipeline user concerns

The user may volunteer a concern mid-pipeline — a change of mind, a note on the diff, a scope
clarification — outside any escalation. A message from an orchestrating session that carries the
user's decision about the work counts the same; merge stays with §7 and the user directly. Treat it
as authorial input that can override the brief, not as another reviewer finding:

1. Classify it: a scope change (edit the brief), a concrete code-level ask (a fix round), or both.
   A standing decision about what the pipeline may do — a base branch on hold, a check the user
   deferred — is a one-line edit to §5: `base <branch> on hold (user, <iso>)`,
   `check <name> deferred (user, <iso>)`.
2. Scope change: follow § Brief editing mid-pipeline, citing "user concern" in the annotation.
3. Fix round: write a minimal findings-shaped input (`## User concern` with `Disposition: fix`,
   `Severity`, `Location`, `Issue`, `Failure scenario`) into the next-numbered `review-round-N.md`
   and dispatch a fresh developer fix round against it. A small edit has a settled outcome and
   a known location, and changes no contract, security boundary or data invariant. Before stage 3
   is ticked, it joins the normal review sequence. After stage 3, use the developer's verified
   push as completion evidence. Record the small-edit decision in the round input for recovery.
   For a parent-owned PR with a changed head, follow § Stack holds and review release. Larger
   edits go through the usual developer → reviewer rounds under the round cap.
4. Act only between worker invocations. If a worker is running, wait for its report. A worker
   waiting on an escalation is not running: edit the brief, then tell it to re-read it in the
   decision message; a fix-round ask waits until that worker reports.

The user's authorial word trumps the brief. If a concern contradicts an active AC, edit the AC;
don't route the user's own note through reviewer classification.

## Stack holds and review release

A standalone run follows the usual pre-ready gate. When a Garden parent owns a stack, use
`message-session` to coordinate; the parent decides when to release review and the peer still owns
its PR. Put the parent and the instruction to pause before review/ready in the initial brief.
This includes `Review loop: none`: the pause protects the ready flip even without a bot.

On internal-review clean, tell the parent the draft PR, reviewed head, base ref and tip, current
main tip, verification result, and remaining gates. Start or recover the watch as usual. Record
the parent's messages in the existing §5 and workflow annotations, then acknowledge the recorded decision and current state. Use the latest applicable instruction from
the full workflow, not the last few annotations from status. When a writer owns the workflow, queue the change and
stop further dispatch until it reports, then record it before routing the report. A running loop
writes only its own state, so the orchestrator can annotate an incoming hold immediately and
update the brief at the loop's next safe waiting point. A duplicate message for the same
decision changes nothing. A new hold supersedes an earlier release even if the head is unchanged.

- **Review hold.** Wait before starting or advancing a configured bot loop, handling external
  review or CI fixes, flipping ready, or merging. An explicit review release clears this hold for
  the head and base it names. A legacy free-text pause also needs its sender's go-ahead on resume.
- **Base hold.** Record which base is unsettled in §5. Do not sync it or start an automatic fix
  against it, even if checks or conflict detection ask for one. Wait for the parent to identify the
  settled base and authorize synchronization. A base hold and a review hold clear independently.
- **Batch.** While review is held, run only the work the parent authorizes. When this PR is next
  to update, record the parent’s synchronization authorization in a workflow note with the
  target ref and settled tip. Wait for any in-flight worker to stop writing, then dispatch a
  developer in `sync-base` mode. That worker integrates the tip without rewriting history and
  retargets if authorized. Respect repository approval rules when changing the target.
  A matching completion note supplies the verified head and base on resume. If the authorization
  is still current and incomplete, re-enter that mode once the old writer and commands are stopped.
  A newer base hold or synchronization decision supersedes an outstanding authorization.

At batch end, use the completed synchronization's verified head and base to start one final
internal review cycle. Record the first artifact number and comparison baseline (the synchronized
base tip) in a workflow note before dispatch. Follow the internal dirty/fix/review path within
that cycle's round budget. Later comparisons use the previously reviewed head in the cycle.
Keep artifact numbers increasing across cycles. On resume, recover unfinished work from the
cycle note and its artifacts before advancing. On clean, report the current verified head and
review evidence to the parent and wait for release.

At normal release the parent confirms that this PR's own upstreams merged and integration passed.
Record the PR, reviewed head, base ref and tip, current main tip and verification evidence. Before
first dispatch under that release, including after a restart before dispatch, compare that evidence
to the current PR and remote refs. Confirm the PR targets and includes current main. Record
admission against the release note when the work starts. If stale evidence or a newer hold
prevents first dispatch, tell the parent the work did not start and wait for a current release.
An explicit early-review override checks the named refs at admission. It can start the configured
loop before the normal dependency and integration gates. Base synchronization, ready and
merge still have their own gates, and the repository's bot policy and merge authority apply.

When a fix outside the loop changes a reviewed head, hold further external intake, ready and
merge. This includes fixes from external intake and a user's direct edit. Use the developer's
verified head and base from the completed round. For a small, settled user edit, carry the prior
review forward with the explicit user direction and developer verification if the delta contains
only that edit. Send that evidence to the parent for a fresh release without another internal
review. For other fixes or a change to the integrated base, use the final-head review cycle
above. Compare against the previous reviewed head on the same base or the new base tip if the
fix integrated a new base.
Recover the handoff from the completed round and any review-cycle note if the worker report was
missed. Once re-released, a draft returns to the pre-ready gate. A PR already ready resumes due
intake and checks on the new head under the normal merge policy.

After admission, use the recorded head and base ref to route follow-ups and recover saved work.
An unrelated advance of main alone leaves the admitted release and trigger valid, including when
main is the base. Continue to check live mergeability and checks at the current PR head. A hold
pauses dispatch. A retarget, change to an upstream PR used for integration, or other invalidation
of the integration evidence requires revalidation. A loop can continue across its own authorized
and verified fix pushes. Use its recorded lineage to distinguish those pushes from an outside
head change, and record its final verified head with the outcome.

When the parent clears a hold and the admitted head, base ref and integration evidence still
apply, resume the same owner and trigger. If new evidence supersedes the saved loop, stop
routing to that owner. Once it and its commands are confirmed stopped, archive the active state
under its release note timestamp and retire its backstop. Tell the parent which PR and release
stopped so it can schedule the next loop. Re-read status, which now reports `pending`. An
eligible draft can start a new loop after fresh admission, preserving the prior decline ledger.
Ignore late reports or backstops for the archived state.
