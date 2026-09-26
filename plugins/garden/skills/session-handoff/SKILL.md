---
name: session-handoff
description: >-
  Use when the user explicitly asks to capture this session's context for a future one — "create a
  session handoff", "hand this off", "write this up for tomorrow", "wrap up for the day", "I'm done
  for today", "save context before I compact / run out of context", "brief the next agent", "prepare
  a handoff for <topic>", or any request to let another session continue incomplete work. Also use
  when the user asks to update or extend an existing handoff. Writes a `.handoffs/*.md` file the
  user can @-reference next session; `session-pickup` is the skill that consumes it. Requires an
  explicit request — a long session, a finished milestone, or a nearly-full context window is not
  by itself a trigger, so never generate a handoff on your own initiative. For distilling durable
  lessons rather than in-flight state, use `reflect` instead. This "handoff" is a written
  `.handoffs/*.md` context file — unrelated to garden's own `garden new --handoff` / `garden
  handoff --to` CLI verbs, which move swarm-lineage placement and write nothing to disk.
---

# Session Handoff

Write a focused file the next session can `@`-reference to skip 10-15K tokens of re-exploration. The handoff stands alone — the next agent may read only this.

Identify the session by `$GARDEN_SESSION_ID`, not any Claude-side session id, if a handoff needs to say which session wrote it — the env var stays stable across an in-pane `/clear`, the Claude-side id does not.

## Output

Run `scripts/init-handoff.sh <topic>` to create `.handoffs/`, keep it out of git, and get the target path. Write the handoff there.

Then reply with only:

- the path as an `@` reference (e.g. `@.handoffs/2026-04-16-wiz-scan-refactor.md`)
- one line summarizing what it covers

Don't reprint the body in chat — the user will read it from the file.

## Structure

Default to three sections. Add the conditional ones only when there's real content for them — empty headers are noise.

```markdown
# Session Handoff: [Topic]

## Instructions

What the next agent should do, in the user's voice. Be specific — name the skill, workflow, or approach. Include any process rules established this session that the next agent needs to follow.

## State

Where things stand. Commits and test counts ground the context quickly. Reference plan files by path rather than restating their content. Stamp volatile status — approvals, CI, deploys — with when you observed it ("approved by X as of 14:20Z"), since it can decay before the next session reads it. Artifacts that exist only in this conversation — drafted review comments, unposted notes, generated snippets — die with the session: if the handoff references one, write it to a file (`.handoffs/` alongside the handoff works) and link the path. A mention without the file hands off a dangling pointer the next session cannot recover.

## Next

Ordered remaining steps. Checkboxes for task lists.
```

Conditional sections:

- **`## Premises`** — load-bearing claims the next session should re-verify before refining within the frame. Load-bearing means removing the claim would change the plan ("we picked X because Y is unsupported" — not "commit Z added W"). `session-pickup` triages four marker types, so flag claims that fall into them: **named direction** ("the approach is X"), **mechanism claim** ("X failed because Y"), **baseline assumption** ("this test currently fails at…"), **cited memory entry** (a `memory/*.md` path the plan leans on). State the claims plainly; pickup handles the verification.
- **`## Failed approaches`** — what was tried and why it didn't work. Saves the next session from repeating dead ends.
- **`## Key files`** — paths the next agent will need, only if not already obvious from Instructions.

## Style

- Imperative, in the user's voice — as if the user is briefing the next agent.
- Reference-card brevity, ~300 words. Not a report.
- Cite the path when a decision rests on a memory entry (`memory/feedback_X.md`), so the next session knows what to re-verify. Memory is fact-at-time-of-write, not eternal truth.
