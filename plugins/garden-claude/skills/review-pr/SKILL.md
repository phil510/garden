---
name: review-pr
description: Review a pull request or local diff with Garden's bundled PR review toolkit agents. Use for general reviews or specialist checks of tests, errors, types, comments, and simplification.
---

# Review a change

Independent reviewers examine different failure modes before their findings are combined. All six
reviewers are bundled in this plugin's `agents/` directory; no separate toolkit installation is
needed. This skill authorizes delegation for the review. Follow applicable project and user
instructions.

1. Establish the repository, requested PR/base or local changes, and review scope from the user.
   Inspect git status and the relevant diff; use `gh` when reviewing a GitHub PR. Include staged,
   unstaged, and relevant untracked changes for a local review. Read applicable project instructions.
2. Select the requested aspects, or all applicable aspects by default:

   | Aspect     | Reviewer                              | Applies to                          |
   | ---------- | ------------------------------------- | ----------------------------------- |
   | `code`     | `garden-claude:code-reviewer`         | General correctness and guidelines  |
   | `tests`    | `garden-claude:pr-test-analyzer`      | Changed tests and coverage          |
   | `errors`   | `garden-claude:silent-failure-hunter` | Changed error handling              |
   | `types`    | `garden-claude:type-design-analyzer`  | Added or modified types             |
   | `comments` | `garden-claude:comment-analyzer`      | Added comments or documentation     |
   | `simplify` | `garden-claude:code-simplifier`       | Simplification after initial review |

   `all` selects every applicable aspect. Use general review for the default review and add
   specialists whose subject changed. Run simplification after the initial review passes. Honor
   the caller's narrower aspect selection and review cap.

3. Dispatch each selected reviewer with the `Agent` tool using its registered name above. Give it
   the repository/worktree, exact diff scope, and relevant project instructions. Run sequentially
   unless parallel review was requested. If delegation is unavailable, disclose that limitation
   instead of presenting an inline pass as independent reviewers.
4. Brief every reviewer to return findings with file/line evidence and confidence, without modifying
   files or publishing comments. This includes the simplifier, whose prompt otherwise edits.
   An explicit request to simplify authorizes edits; assign file ownership and tell it other agents
   may be working in the repository. Review alone does not authorize fixes or publishing results.
5. Wait for every reviewer to finish. Deduplicate findings, check contested claims against source,
   and summarize critical issues, important issues, suggestions, strengths, and recommended actions.
   Disclose missing aspects or incomplete reviews. Recommend addressing critical issues first and
   rerunning the affected reviews after fixes. Act on recommendations only within the user’s authorization.

The source, license and fork update policy are in `../../third-party.md`. Reviewer prompts are
editable; review the Codex counterpart for semantic parity when changing them.
