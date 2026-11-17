---
name: review-pr
description: Review a pull request or local diff with bundled specialist reviewers for correctness, tests, errors, types, comments, and simplification. Use when the user asks for a PR review or specific review lenses.
---

# Review a change

Independent reviewers keep each lens from inheriting the first reviewer's conclusions. Use the
bundled Anthropic prompts in fresh native Codex subagents; installing named TOML roles is not
required. This skill authorizes delegation for this review.

1. Establish the repository, requested PR/base or local changes, and review scope from the user.
   Inspect git status and the relevant diff; use `gh` when reviewing a GitHub PR. Include staged,
   unstaged, and relevant untracked changes for a local review. Read applicable project instructions.
2. Select requested lenses, or all applicable lenses by default:

   | Lens                                       | Prompt under `../../agents/` |
   | ------------------------------------------ | ---------------------------- |
   | General correctness and project guidelines | `code-reviewer.md`           |
   | Test quality and behavioral coverage       | `pr-test-analyzer.md`        |
   | Error handling and silent failures         | `silent-failure-hunter.md`   |
   | Type design and invariants                 | `type-design-analyzer.md`    |
   | Comment accuracy                           | `comment-analyzer.md`        |
   | Simplification                             | `code-simplifier.md`         |

   Paths are relative to this skill's directory, not the project working directory. Resolve the
   installed skill directory before dispatch and pass the absolute prompt path. Use general review
   for the default review, add specialists whose subject changed, and run simplification after the
   initial review. Honor a caller's narrower lens selection and review cap.

3. Spawn a fresh native generic subagent for each selected lens. Give it the repository/worktree,
   exact diff scope, relevant project instructions, and its prompt path to read in full. Inherit
   the current model unless the caller specifies otherwise. The prompt's Claude frontmatter,
   tool names and invocation examples are source metadata, not Codex role registration: use the
   native tools available in this session and apply both AGENTS.md and CLAUDE.md where relevant.
   Run sequentially unless parallel review was requested. If native delegation is unavailable,
   report that limitation instead of presenting an inline pass as independent reviewers.
4. Tell each reviewer to report findings with file/line evidence and confidence, without editing
   files, posting comments, or running publication commands. This also applies to the simplifier,
   whose upstream prompt normally edits code. Only an explicit user request to simplify authorizes
   those edits; assign that agent file ownership and tell it other agents may be working nearby.
   These are task instructions, not a separate read-only sandbox.
5. Wait for every reviewer to finish, using the harness's supported waiting mechanism. Deduplicate
   findings, check contested claims against source, and summarize critical issues, important issues,
   suggestions, strengths, and recommended actions. Disclose missing lenses or incomplete reviews.
   A review alone does not authorize fixes or publishing its results.

The source, license and fork update policy are in `../../THIRD_PARTY.md`. Reviewer prompts are
editable; review the Claude counterpart for semantic parity when changing them.
