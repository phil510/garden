---
name: alert
description: >-
  Use when this session is blocked on something only the human can provide — a scope or judgment
  call, an approval reserved for the human, a manual step such as a login — and it has already
  asked for it three times — the original and two repeats — without an answer. Not for the first
  ask, and not for the next question in a live conversation. Also use for the events a workflow skill names as major on their
  own (ship-it's "ready to merge"), and whenever an alert is already up and what is open has
  changed or nothing waits on the human any more. Covers raising, rewriting and clearing the
  session's alert with `garden alert`.
---

# Alerting the human

An alert puts a red "alert!" on this session in garden, so the human sees it among many sessions
without opening each one. That only works while alerts are rare: an alert raised for every question
is just `waiting` again, and the human learns to ignore it. Alert when the human would otherwise
miss something that is stuck on them, not to report that you are working.

## When to alert

- **Blocked on the human, and the ask has gone unanswered.** You need something only the human can
  give: a scope or judgment call, an approval reserved for the human, a manual step like a login.
  You have asked for it three times — the original and two repeats — and still have no answer. The
  first ask is just a question; the human may be reading the pane right now. The next question in a
  live conversation never warrants an alert.
- **A few events are major on their own.** The workflow skills name them; today that is `ship-it`'s
  "ready to merge". These alert immediately, without waiting for a repeat.

## Keeping it current

A session has one alert. `garden alert "<text>"` raises it, or replaces it if one is up. Replacing
never appends, so write the full current ask each time, in enough words that the human can act on it
without opening the session. Multi-line text is fine.

```
garden alert "Need a decision: ship the migration behind a flag or all at once? Asked three times."
garden alert clear
```

- **Update it when what's open changes.** If two of three questions get answered, rewrite the alert
  to the one still open.
- **Clear it as soon as nothing waits on the human.** Garden never clears it for you, not even when
  a new prompt arrives (messages from an orchestrator arrive as prompts too), so a stale alert
  stays red until you clear it or the human dismisses it.

Both commands act on your own session only. Outside a garden session they exit non-zero with the
error on stderr; there is no one to alert, so ask in the pane instead.

## When not to alert

Progress, done notices, FYIs, and anything an orchestrator or the codebase can answer. If someone or
something other than the human can unblock you, ask them.

## Context

How readily to alert depends on who is already watching:

- **Solo and orchestrator sessions** rarely alert. The human watches those panes directly, so a
  question there is already in front of them.
- **Child sessions of an orchestrator** may alert more readily. They report to both the
  orchestrator and the human, and the human may be watching a different pane. The repeat rule still
  applies; a child just meets it sooner, since an unanswered ask there is more likely to go unseen.
