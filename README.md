# garden

A local web console for running many Claude Code sessions at once across many repos and worktrees. tmux owns the Claude Code processes; garden is a viewport and control surface over them, so closing garden or restarting its server never touches a running session.

## Packages

```text
packages/
  server/     # Node 22, Fastify, ws — owns tmux and git, serves the API and the built client
  web/        # React, Vite, xterm.js — the console UI
  shared/     # API types shared between server and web
```

`docs/architecture.md` describes how the server and client are laid out inside those packages, and the import rules between layers.

## Prerequisites

- Node 22
- pnpm
- tmux 3.6 or newer — required, not optional. garden has no Windows support, because tmux doesn't run there. Below 3.6, `utempter_remove_record` resets `SIGCHLD` to `SIG_DFL` around its own fork-and-wait, discarding the exiting pane's `SIGCHLD` so `pane_dead_status` never gets set ([tmux/tmux#4559](https://github.com/tmux/tmux/issues/4559), fixed in 3.6). Ubuntu 24.04's apt package is tmux 3.4; install a newer tmux from another source on that distro.

## Setup

```bash
pnpm install
```

That is all: lefthook installs the pre-commit hook itself when its package build script runs, so
there is no separate step. If the hook ever goes missing, `pnpm rebuild lefthook` restores it.

**Pre-commit gate.** lefthook runs typecheck, lint, formatting, and unit tests on every commit. CI runs those plus a workspace build and the integration tier, which needs tmux — so a clean commit is a good signal, not a guarantee of a green PR.

## Installing the `garden` command

```bash
pnpm cli:install
```

This builds every package and writes a `garden` launcher into `~/.local/bin` (pass
`--bin-dir <dir>` for somewhere else) that runs this checkout's build in place. It warns if
that directory isn't on `PATH` or another `garden` comes before it, and it won't overwrite a
`garden` it didn't write unless you add `--force`. Install from the main checkout rather than a
worktree: the launcher stops working when the directory it points at is removed.

To update after pulling, or after moving the checkout, run the same thing from the checkout:

```bash
pnpm install && pnpm cli:install
```

If the build is missing, `garden` says so and prints that command instead of a stack trace.

## Configuration

garden reads `~/.garden/config.json` on startup, writing a default one on first run. Fields:

- `port` — the port the server listens on. Default `4310`.
- `roots` — the repo roots garden scans for sessions. Default `["~/Desktop/Extend"]`. Each repo
  directly under a root is listed with its worktrees, found under `<repo>/.worktrees/` or, for a
  bare clone kept in `<repo>/.bare/` with a `.git` file pointing at it, beside the clone.
  Applies after a restart.
- `permissionMode` — `"default"` or `"bypassPermissions"`. Default `"default"`. `"bypassPermissions"`
  skips Claude Code's permission prompts for every session garden spawns or resumes.
- `deadSessionCap` — dead sessions shown per repo group, swarm group and Solo block before "Show N more"; a whole number
  1–1000. Default `10`. Applies after a restart and a page reload.
- `claudeCommand` — the command used to launch Claude Code. Default `"claude"`. Split on
  whitespace into argv with no shell-style quoting or escaping, so a wrapper like
  `"ec bedrock launch claude --"` works but a quoted argument does not. Editable from the
  settings panel in the app (the gear icon in the topbar); `GARDEN_CLAUDE_COMMAND` still takes
  precedence when set. A saved change applies to the next new or resumed session — no restart
  required — but leaves already-running sessions on whatever command spawned them.
- `ignoreAuthors` — PR comment and review authors whose activity a watch does not report. Default
  `[]`.
- `quietWindowMinutes` — minutes of PR quiet required before a digest is delivered; a whole
  number, `0` allowed. Default `3`.
- `pollIntervalMinutes` — minutes between PR polls; a positive whole number. Default `5`.

  These three are also editable from the settings panel, and a saved change is read on the next
  use — no restart required.

## Dev loop

`pnpm build` builds every package; an installed `garden` (see above) picks the new build up on its next run. `garden` starts the server and opens the console in a Chrome app window.

For UI work, skip the build. Run `pnpm dev:sandbox:server` in one terminal and `pnpm dev:sandbox:web` in another, then open the URL vite prints. The sandbox is a second, fully isolated garden instance — its own port, tmux socket, app dir, and transcripts dir — so it runs concurrently with an installed `garden` without either one reaching the other's sessions or state. `dev:sandbox:server` runs the server from TypeScript source and writes no pid file, so `garden stop` will not reach it — Ctrl-C stops it. `dev:sandbox:web` serves the client with HMR and proxies the API routes and both WebSockets to the sandbox server, whichever port it's running on.

## Where to start

- `docs/architecture.md` — the layering, the design invariants, and how session state is sourced.
- `docs/README.md` — how the docs are organized.
