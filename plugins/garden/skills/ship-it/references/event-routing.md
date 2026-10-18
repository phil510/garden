# Event routing

Once internal review is clean, garden's PR watch is what wakes you: each digest is one
`Monitor event:` line naming what changed since the last poll — `#241 o/r: [digest 3f9a1c0b7d2e]
2 reviews (alice), 3 comments, checks failed: build, merge conflict`, ending in `merged` or
`closed` when the PR is done. The line is a pointer, never content, and may arrive twice; the
`watch-pr` skill covers the mechanism.

Two things a digest never tells you: that checks have **passed**, and that the PR has become
mergeable. The watch's default kinds don't report passing checks. That's why § Checks wait exists.

## Digest routing

Route off the line alone. Reading the PR to decide what the digest means is the job of whoever you
hand it to, and doing it yourself spends your context on text that worker is about to read anyway.

| Digest                                  | Action                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| ends in `merged`                        | SKILL.md's finish step, at once, even with a round in flight. Barrier — no further routing.                                       |
| ends in `closed`                        | SKILL.md's abort path (`--status aborted`), at once; leave branch, worktree, commits and PR intact. Barrier — no further routing. |
| anything else, while a review loop runs | `SendMessage` the line verbatim to the `review-loop` worker, and defer what it doesn't own (§ During the review loop).            |
| anything else, otherwise                | Fresh reviewer in external mode with `${PR_URL}` and the line as `${DIGEST}`.                                                     |

"While a review loop runs" means the brief names a loop and `pipeline-status.sh` reports
`review_loop.outcome` as `pending` or `running`. With the loop `skipped`, every non-terminal digest
goes to a reviewer from the start.

Non-terminal digests are routed one at a time. One that arrives while a reviewer or developer round
is in flight waits until that round has reported, then gets a fresh reviewer like any other. The
reviewer diffs against everything already in `events/`, so a queued digest whose activity a later
round absorbed comes back `nothing-new`.

The reviewer reads the items behind the digest with `garden digest`, skips any already recorded in
`events/`, writes one `events/<iso>-activity.md` for the rest, and classifies. Its report is one of:

- `nothing-new` — a duplicate digest, or only our own replies and commits. No event file. A wasted
  spawn on our own echo is the accepted cost of not filtering it here.
- `event <file> classified — P fix, Q decline, R escalate` — route per § Dispositions. Zero findings
  is valid: activity that needed no action (an approval, a bot heartbeat) is still recorded so the
  next intake doesn't see it as new.
- `pr merged` / `pr closed` — the PR was already done when the reviewer read it (most often on a
  resume). Finish or abort, as for the matching digest.

Either of the first two may end `; clean <head-sha>` (Contract § Worker reports): nothing is open
for the pipeline at that head. Go to SKILL.md's merge-eligibility step. The reviewer doesn't judge
merge readiness — it reads no merge state and no review decision — so `clean` is a prompt to check,
not a verdict.

## During the review loop

While the loop runs, the review-loop worker owns the bot's threads, and a reviewer classifying the
same comments would be a second writer on them. So the worker gets every non-terminal digest and
acts only on the bot's review; the rest of the line waits. For each `checks failed` or
merge-conflict segment, and each review by an author other than the bot's login (the worker's
`triggered` names it), append
`> NOTE <iso> — orchestrator: deferred to post-loop triage: <segment> (digest <id>)`.

When the loop ends — `passed` or `blocked` — and `workflow.md` has any such note, spawn one external
reviewer with `${DIGEST}` `none`, which reads the PR's current state rather than replaying each
digest, because the loop's own commits may already have cleared a failure. Comment authors aren't
on the line, so a human comment during the loop is seen only if something else prompts that read —
accepted, since nobody is asked to review a draft.

## Checks wait

Run one after the ready flip and after every push a fix round makes. It's what notices a PR going
green — without it, a PR whose last check passes with no other activity sits mergeable and nobody
acts.

Check mergeability first (`gh pr view <url> --json mergeable`): a conflicting PR often gets no CI
run at all, so `gh pr checks` reports "no checks" and a wait on it either stalls or misreads the
repo as having no CI. `CONFLICTING` is a fix round (§ Dispositions), not a wait. `UNKNOWN` means
GitHub is still computing; re-query under a bound.

Then wait in a **background** Bash call — `run_in_background`, so the harness notifies you when it
exits and you stay responsive to messages and digests meanwhile. `gh pr checks` has no timeout flag
and `timeout` isn't on stock macOS, so the deadline is a loop of its own. `gh pr checks` exits 8
while checks are pending:

```bash
end=$(( $(date +%s) + 1800 ))
while :; do
  gh pr checks <url> > /dev/null 2>&1; rc=$?
  [ "$rc" -ne 8 ] && break
  [ "$(date +%s)" -ge "$end" ] && { rc=timeout; break; }
  sleep 30
done
echo "checks-wait rc=$rc"; gh pr checks <url> --json name,bucket 2>&1 || true
```

When it exits, read the result:

- **rc 0** — every check passed. Go to SKILL.md's merge-eligibility step.
- **rc 1 with failing checks** — a digest reporting the failure will reach a reviewer anyway; don't
  dispatch from the wait as well. A check §5 records as deferred by the user is already decided and
  needs no fix round.
- **rc 1 with "no checks reported"** — either the repo has no CI or nothing has reported yet. The
  merge-eligibility step tells those apart; don't conclude either here.
- **`timeout`** — checks still pending at the deadline. Tell the user which are still pending rather
  than waiting silently.

A new push supersedes a running wait: start a fresh one and ignore the old one's result.

## Dispositions

Bot and human comments get the same dispositions:

- `fix` → spawn a fresh developer in fix-round-from-event mode; it commits, replies, and resolves
  the conversation. Its push starts a checks wait.
- `decline` → nothing to dispatch: the reviewer has already replied with the reason and left the
  conversation unresolved.
- `escalate` → the reviewer annotates and sends `ESCALATING`; resolve it (`escalate-resume.md`),
  then message the decision back to that reviewer.

Check failures and merge conflicts collapse to `fix | escalate` — you can't decline a broken build
or a conflict, and no PR reply is posted. A conflict's `fix` is the developer merging the base
branch and resolving it; it escalates only when the resolution needs a judgment §5 doesn't cover.
On a stacked PR whose brief records the base as on hold, don't dispatch that merge: the base is
about to change, so the resolution would be against code that may not land. Note the conflict and
wait for the hold to lift.

`fix | escalate` is for undecided failures. A check the brief records as deferred by the user is
already decided: a digest whose only failure is that check needs no reviewer, and a reviewer that
meets it alongside other activity records it as deferred without escalating again. To stop the
wakes themselves, add `--ignore-check <name>` to the watch (`watch-pr` covers it).

**Appeal.** If a new comment follows up on a thread previously classified `decline`, the reviewer
escalates `ambiguity` rather than re-classifying. Human push-back gets human attention, not a
second automated decline.

**Sequencing.** The reviewer classifies **all findings in one event in one invocation**. All clean
(`fix` / `decline`) → dispatch every `fix` finding to one fresh developer round. Any `escalate` →
the reviewer reports without dispatching; once the decision is in, it re-classifies and reports,
and only then do you dispatch. No partial dispatch: with three fixes and one escalate, the fixes
wait for the decision, which keeps ordering deterministic.

**Stop is a barrier.** Once a digest ends in `merged` or `closed`, all routing ceases, without
waiting behind a round in flight: nothing that round produces can still land usefully — a developer
dispatched next would push to a merged branch — and waiting keeps the `active` lock held on a
finished pipeline. The in-flight worker's report, when it arrives, isn't dispatched. Anything else
the final digest named, any event file a reviewer wrote but nobody classified, any classified `fix`
finding no developer round picked up, and the late report's findings go in the completion summary
under **"Unrouted at stop"**, with what the source gives: the final digest only its counts, authors
and digest id (`garden digest <id>` lists the items), an event file or report its findings and
path. `pipeline-finish.sh` reports the event files it can see as `unrouted_candidates` — it derives
them, so verify before quoting them to the user.

## Event file lifecycle

One file per reviewer intake of new PR activity, appended in place from detection to resolution.
The reviewer's agent definition owns the file's shape.

```
Reviewer (external) fetches what's new → writes the event file
   │
   ▼
Reviewer appends its classification section
   │
   ▼
decline: reviewer posts a reply → records reply_id
escalate: escalate-resume.md; the escalation event gets a Resolution block
   │
   ▼
Orchestrator reads the counts → any fix findings → dispatches a developer
   │
   ▼
Developer fixes → replies → resolves conversations → appends a Developer round section
   │
   ▼
Lifecycle complete; the file is the permanent audit trail
```

- **Self-maintaining dedup.** Every observed or generated id lands in one of the id sections; the
  next intake scans and skips.
- **Linear audit trail.** One file tells the whole story of one external event — findings,
  reasoning and resolutions live only there.
- **Atomic writes.** Each append is a full-file rewrite via atomic rename.
- **Crash windows are accepted.** Some records and the actions they describe are separate writes —
  a classification and its replies, a push and its developer-round marker — so a worker dying
  between them can drop a reply or repeat a fix, and nothing reconciles that.
- **The findings-section shape is the developer's input contract.** Both `events/<iso>-<kind>.md`
  and `review-round-<k>.md` expose it — `Disposition: fix`, `Severity`, `Location`, `Issue`,
  `Failure scenario` — one contract, two sources.
