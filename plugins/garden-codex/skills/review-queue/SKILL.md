---
name: review-queue
description: >-
  Use when the user asks about their GitHub review requests or wants to act on one: "what reviews
  do I have", "what's in my review queue", "anything waiting on my review", "start a session for
  that review", "claim that review for this session", "dismiss that review request", "take me off
  that PR". Covers reading and acting on garden's review queue with `garden reviews`: list, start,
  claim and dismiss.
---

# The review queue

garden polls GitHub for pull requests where the human's review is requested and keeps them as a
queue, the same one the Reviews panel in the browser shows. `garden reviews` reads and acts on that
queue from a session, so the user never has to switch to the browser to see what is waiting or to
get a session going on it.

```
garden reviews list --json
garden reviews start <owner/name#N> --json
garden reviews claim <owner/name#N> [--session <id>] --json
garden reviews dismiss <owner/name#N> --json
```

`<owner/name#N>` is the `key` that `list` prints; a malformed one is a usage error. `start`,
`claim` and `dismiss` exit 1 for a PR that is not in the queue.

## list: see what is waiting

`list` prints the queue the server already holds, not a fresh GitHub search, so it matches the
panel. Output is `{ "items": [...], "polledAt", "fault" }`; each item has `key`, `title`, `author`,
`draft`, `updatedAt`, `clonePath` and `sessionId` (the session linked to that PR, or null).

A `fault` (`gh-missing`, `logged-out`, `rate-limited`, `incomplete`, `error`) is data, not a
failure: the command still exits 0 and `items` is the last good poll's. An empty `items` with a
fault set means the queue is unknown, not empty, so check `fault` before telling the user nothing is
waiting.

## start or claim: get a session onto a review

- **`start`** is the panel's Start/Open. It prints the linked session's id, and when none is linked
  it creates one in the repo's local clone (`--json`: `{ "sessionId" }`). Use it when the user wants
  a session on the review and none exists yet. With no local clone it exits 1.
- **`claim`** links the PR to a session that already exists, instead of creating one. Use it when
  the work is already underway in a session, typically this one. `--session` defaults to
  `GARDEN_SESSION_ID`; with neither it exits 1 before sending anything. If the PR was linked to
  another session the link moves, and the output names the old one (`--json`:
  `{ "sessionId", "previousSessionId" }`, with `previousSessionId` null when nothing moved). An
  unknown session id writes no link.

The link is what makes the panel show Open session for that PR, so which verb you pick decides which
session the user lands in.

## dismiss: remove the request on GitHub

`dismiss` removes the human's review request on GitHub and prints `{ "ok": true }`. It does not
prompt and garden cannot undo it, so confirm with the user before running it, naming the PR. A
GitHub refusal exits 1 with `GitHub refused the dismiss: <kind> (<status>)` on stderr.
