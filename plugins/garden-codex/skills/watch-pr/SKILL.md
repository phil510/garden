---
name: watch-pr
description: >-
  Watch a PR's reviews, comments, CI, conflicts and closure from a Codex garden session.
  Use when this session has a PR to watch, including "watch this PR", "wait for CI",
  "tell me when the review lands", or when you would otherwise sleep and poll GitHub.
  Also use for incoming digest lines such as "#241 owner/repo: [digest ...]". Covers
  starting the forwarding process and watch, reacting to digests, and stopping them.
---

# Watching a PR from Codex

A garden session can ask garden to watch a pull request and be woken when it changes, so the wait
costs nothing: no sleep loop, no polling turn, no poller of your own. Garden polls GitHub. A
separate CLI process forwards digests into this session through the same delivery route as
`garden send`, acknowledging only after enqueue succeeds, and a digest arrives as one line.
Installing this plugin does not start that process: Codex does not run the Claude plugin's monitor.

## Start the forwarder once there is a PR to wait on

Inside the intended Codex garden pane, start one owned long-running shell task:

```sh
garden events --follow --forward-to-session
```

Keep the execution tool's process handle and keep stderr available for reconnect diagnostics.
Do not pipe ordinary `garden events --follow` into `garden send`: stdout mode acknowledges before
the next command can enqueue the digest. The process uses this pane's inherited instance
environment and stable `GARDEN_SESSION_ID`. Start no second forwarder for the same session; a
nested Codex process inherits that id too, and this mode cannot distinguish it from the pane
owner. The forwarder does not die with Codex, so stop the one you own when no remaining watch in
this session needs it.

## Start a watch once there is something to wait on

Start it when the PR exists and your next step depends on what happens to it: you are waiting for a
review, for CI, or for a review bot to settle. Not before — a watch on work you are still writing
only generates turns about code you know is unfinished.

```
garden watch <pr> [--repo <owner/name>] [--on <kinds>] [--ignore-check <name>]... [--unignore-check <name>]...
```

`--repo` defaults to the `origin` of your working directory, so it is only needed for a PR in
another repo. The default kinds cover reviews, comments, failing checks, conflicts and the PR
closing; pass `--on` only to narrow or widen them (for example `checks:all` to hear about passing
checks too). Re-running `garden watch` for a watch that still exists changes only what you pass:
without `--on` it keeps the kinds, without the ignore flags it keeps the ignores. But a conversation
reset ends a session's watches, and a re-run after that creates a fresh watch with the default kinds and no
ignores, which silently drops a `checks:all` or an ignored check. So when unsure the watch
survived, repeat every flag you passed (`--on` and each `--ignore-check`); there is no need to
check first. `references/cli.md` in the
`orchestrate-sessions` skill has the flags and the kinds.

Confirm it took with `garden watches`: your PR should be listed with status `active`, and the
session's `pipeConnected` should be true in `garden ls --json`. Status `error` means garden cannot
reach GitHub or the repo; `garden watches --json` shows the entry's `errorReason`.

## React: a digest is a pointer, not the content

A digest line says that something changed, never what it says. Only the segments that apply
appear, in this order: reviews, comments, failed checks, passed checks (`checks:all` only), merge
conflict, then `merged` or `closed`. The digest id follows the colon:

```
#241 acme/widgets: [digest 3f9a1c0b7d2e] 2 reviews (coderabbitai[bot], alice), 3 comments, checks failed: build
```

`garden digest <id> --json` returns the ids and metadata of exactly the items the line counted
(review, comment and check-run ids, authors, times, head sha), so you can fetch those with `gh`
instead of rereading the whole PR. A digest that replaced an undelivered one carries its id in
`replaces`, and its items include the earlier ones. The detail is still a pointer: no titles,
bodies or comment text, so `gh` remains where content comes from. It is kept 7 days from mint
(newest 20 per watch); after that the command exits 1.

Treat it as a prompt to look, then act on what you find:

1. Read the PR's current state from GitHub with `gh` — reviews, review threads, comments, check
   runs — rather than reasoning from the line. The line is a summary taken at poll time; the PR may
   have moved since, and it never carries the review text.
2. Several kinds can arrive in one line, as above. Handle each one; a failing check does not make
   the reviews any less pending.
   A check that fails on every push for a reason the user has already decided to handle, now or
   later (a deferred CVE scan, say), keeps minting a digest each time. Once they have decided,
   mute it with `--ignore-check '<name>'`, the exact check run name or commit status context,
   case-sensitive. Never ignore a check to make a failure go away before that decision. It mutes
   passing and failing runs alike until you `--unignore-check` it or the watch ends, and
   unignoring does not replay what was muted. `garden watches` lists a watch's ignored checks.
3. Decide from what you read. A digest can be a duplicate — delivery is at least once, so a line
   can arrive again after a reconnect, and queue acceptance does not prove the model read it. If a reread shows nothing new since you last acted, go back
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

A watch that stays `active` with a `pending` marker (`pendingDigest` true in `garden watches
--json`) long after activity you can see on GitHub means nothing is draining it. Check
`pipeConnected`, the forwarder task and its stderr. Correct a failed connection or restart the
owned forwarder while retaining the pending watches; the pending digest is delivered once it
connects, as long as that is within 7 days, and a watch whose session has no pipe for 7 days is
ended. Until then, check the PR yourself with `gh`. Do not start a poller of your own in its
place: it would be the polling loop the watch exists to avoid, and a stuck pipe is a fault to get
fixed, not hide behind a second mechanism.

A session not started through garden has no pipe by design, and `garden watch` from it has no
session to attach to unless you pass `--session <id>`, which only helps if some garden session
exists to name.
