---
name: review-pr
description: Review a pull request or local diff with Garden's bundled PR review toolkit agents. Use for general reviews or specialist checks of tests, errors, types, comments, and simplification.
---

# Review a change

Read `../../vendor/pr-review-toolkit/commands/review-pr.md` relative to this installed skill's
directory for the upstream review workflow. Invoke its reviewers with the `Agent` tool using
`garden-claude:<role>` rather than the upstream plugin namespace. All six reviewers are bundled;
no separate toolkit installation is needed. Follow applicable project and user instructions.

For a review request, brief every agent to return findings without modifying files or publishing
comments. This includes `garden-claude:code-simplifier`, whose upstream prompt otherwise edits.
An explicit request to simplify authorizes edits; assign file ownership and account for other
agents working in the repository. The wrapper changes invocation only; the upstream files and
registered reviewer prompt copies are preserved byte for byte.
