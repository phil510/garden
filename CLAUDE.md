# CLAUDE.md

Runbook for Claude Code sessions working in this repo. Read this first; load other docs on demand.

## About this project

garden is a local web console for running many Claude Code sessions at once across many repos and worktrees. tmux owns the Claude Code processes; garden is a viewport and control surface over them — it never becomes the thing keeping a session alive.

`docs/architecture.md` is canonical for where code goes — the layering, the dependency rules between layers, the state projection at the centre of the server — and for the design invariants and rejected alternatives behind them. Read it before writing server or web code, not only when a task is explicitly about structure. Its boundaries are enforced by scoped `no-restricted-imports` rules, so crossing one fails `pnpm lint` instead of starting a design conversation — when that happens, the layering is what's wrong, not the lint config. Planned and in-flight work lives in GitHub issues.

## Environment and tests

Node 22 (`.nvmrc`) and pnpm 10 via corepack. `.npmrc` pins the public registry on purpose, so a user-level CodeArtifact config can't capture installs here — leave it alone.

`package.json` holds the script roster. `pnpm validate` (typecheck, lint, format check, unit tests) is the gate worth running before pushing; lefthook runs the same set pre-commit, and CI adds a build.

Tests come in two tiers, and the split matters: `pnpm test` is the unit tier only. The integration tier is `pnpm test:integration`, it drives real tmux, and it needs tmux installed locally — which is why pre-commit skips it and CI runs it as its own job. A clean commit is a good signal, not a guarantee. `docs/testing.md` is canonical for how to write either tier.

A concurrent sandbox needs its own port, tmux socket and app dir — see `docs/testing.md` for the `GARDEN_SANDBOX_*` variable names.

## Conventions

- Doc filenames: `YYYY-MM-DD-<kebab-slug>.md`. The date is the day the doc lands, not a target date.
- Branch names: `<type>/<issue-number>-<slug>` — type is one of `feat|fix|chore|docs`, chosen from the nature of the change; the number is the GitHub issue. **This is a GitHub issue number, not an Extend `XAD-####` ticket ID.**
- Commit messages: descriptive sentences, in logical chunks that each stand on their own. No conventional-commits prefixes (`feat:`, `fix:`, etc.).
- PRs follow `.github/pull_request_template.md` and include `Closes #N`.
- Use the `gh` CLI for issues and PRs. Issue templates live in `.github/ISSUE_TEMPLATE/`.
- The Claude Code plugin lives in `plugins/garden/`. Its manifest deliberately declares no
  `version`, and the marketplace entry no `description` — `plugins/garden/README.md` says why, and
  adding either back is what makes plugin updates silently stop landing.
- A diff that reads fine can still render wrong, so a UI-visible change (anything that alters what
  the browser renders) carries before/after screenshots, captured with the `garden-sandbox` skill
  and listed in the PR's `## Visual evidence` section. A capture that can't be made is reported in
  the PR, not skipped.
- Stay inside the scope of the issue. Work you find outside it gets surfaced, not silently
  absorbed — but surfacing is not the same as deferring. When what you found is in the code you
  are already changing, the default is to fix it now: you have the context loaded and the reviewer
  has the diff in front of them, where a follow-up issue costs someone a fresh page-in to change
  three lines. "Ready except for one thing" is the phrase to distrust — it means the PR isn't
  ready, not that the thing needs an issue.
- File it for later when the work is genuinely separate: another subsystem, or a change that needs
  its own design conversation. Among those, loudness decides what may wait. Something that errors
  in your face will be found again, so deferring it is cheap; something that fails quietly will
  not be, and an issue is where it goes to be forgotten.
- Between those two, ask. "Fix it here or file it?" is one line, and whoever is reviewing usually
  knows immediately. With nobody to ask, fix it and say so in the PR body — a reviewer can undo a
  fix they see, not a decision they never heard.

## Docs

`docs/README.md` is the index and decides where a new doc goes. `docs/architecture.md` and `docs/testing.md` are living docs — current truth, updated in place. Specs under `docs/specs/` are frozen once merged and go stale as the code moves past them; load only the one relevant to the task. `docs/plans/` is gitignored working state.
