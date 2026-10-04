---
name: watch-pr
description: >-
  Use when this session has opened or is waiting on a pull request and needs to hear when something
  happens to it — reviews, comments, CI results, a merge conflict, the PR closing — instead of
  polling GitHub itself. Triggers include "watch this PR", "tell me when the review lands", "wait
  for CI", "let me know when checks finish", "keep an eye on the PR", any point where you would
  otherwise sleep-and-poll `gh pr view`, and any `Monitor event:` line that starts with `#<number>
  <owner>/<name>:`. Covers starting a watch, what to do when its digest arrives, and stopping it.
---

# Watching a PR

A garden session can ask garden to watch a pull request and be woken when it changes, so the wait
costs nothing: no sleep loop, no polling turn, no `Monitor` call of your own. garden polls GitHub,
and the plugin already connected a pipe to your session when it started — a digest shows up as a
`Monitor event:` turn carrying one line.

## Start a watch once there is something to wait on

Start it when the PR exists and your next step depends on what happens to it: you are waiting for a
review, for CI, or for a review bot to settle. Not before — a watch on work you are still writing
only generates turns about code you know is unfinished.

```
garden watch <pr> [--repo <owner/name>] [--on <kinds>]
```

`--repo` defaults to the `origin` of your working directory, so it is only needed for a PR in
another repo. The default kinds cover reviews, comments, failing checks, conflicts and the PR
closing; pass `--on` only to narrow or widen them (for example `checks:all` to hear about passing
checks too). Re-running `garden watch` for the same PR changes nothing but the kinds, which it
replaces: a re-run without `--on` resets a widened set to the defaults, so repeat your `--on` if you
passed one. That makes it safe to re-run when unsure a watch survived (`/clear` ends a session's
watches), and there is no need to check first. `references/cli.md` in the
`orchestrate-sessions` skill has the flags and the kinds.

Confirm it took with `garden watches`: your PR should be listed with status `active`. Status `error`
means garden cannot reach GitHub or the repo; `garden watches --json` shows the entry's `errorReason`.

## React: a digest is a pointer, not the content

A digest line says that something changed, never what it says. Only the segments that apply
appear, in this order: reviews, comments, failed checks, passed checks (`checks:all` only), merge
conflict, then `merged` or `closed`:

```
#241 acme/widgets: 2 reviews (coderabbitai[bot], alice), 3 comments, checks failed: build
```

Treat it as a prompt to look, then act on what you find:

1. Read the PR's current state from GitHub with `gh` — reviews, review threads, comments, check
   runs — rather than reasoning from the line. The line is a summary taken at poll time; the PR may
   have moved since, and it never carries the review text.
2. Several kinds can arrive in one line, as above. Handle each one; a failing check does not make
   the reviews any less pending.
3. Decide from what you read. A digest can be a duplicate — delivery is at least once, so a line
   can arrive again after a reconnect. If a reread shows nothing new since you last acted, go back
   to what you were doing, or idle.

A digest ending in `merged` or `closed` means the PR is done. The watch removes
itself once that digest is delivered, so a later `garden unwatch` for it exits 1 ("not watching").

## Stop when your part is done

```
garden unwatch <pr> [--repo <owner/name>]
```

Do this when nothing further on the PR is yours to act on — you handed it off, the review loop
converged, or you were told to stop. Do not wait for the PR to close: a watch you leave behind keeps
waking you for activity you no longer own. `--repo` is needed only if you watch the same PR number
in more than one repo. `garden unwatch --all` drops every watch for the session.

## When digests cannot reach you

The pipe is connected by the garden plugin when a session starts, so a session has none until it
restarts if the plugin was installed after it began, or if its garden CLI predates `garden events`. `garden
watches` gives it away: a watch that stays `active` with a `pending` marker long after activity
you can see on GitHub means nothing is draining it. Restarting the session fixes the cause, but not
from inside it: `garden kill` ends your own process before you could run `garden resume`, so ask the
user, or the session that started you, to run `garden kill <id>` and `garden resume <id>` from
outside. The conversation survives, and the pending digest is delivered once the new process
connects, as long as that is within 7 days; a watch whose session has no pipe for 7 days is ended.
Until then, check the PR yourself with `gh`. Do not start a `Monitor` of your own to poll in its
place: it would be the polling loop the watch exists to avoid, and a stuck pipe is a fault to get
fixed, not hide behind a second mechanism.

A session you did not start through garden (a plain `claude` in a terminal) has no pipe by design,
and `garden watch` from it has no session to attach to unless you pass `--session <id>`, which
only helps if some garden session exists to name.
