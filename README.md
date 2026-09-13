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

## Configuration

garden reads `~/.garden/config.json` on startup, writing a default one on first run. Fields:

- `port` — the port the server listens on. Default `4310`.
- `roots` — the repo roots garden scans for sessions. Default `["~/Desktop/Extend"]`.
- `permissionMode` — `"default"` or `"bypassPermissions"`. Default `"default"`. `"bypassPermissions"`
  skips Claude Code's permission prompts for every session garden spawns or resumes.

## Dev loop

`pnpm build` builds every package. Linking the `garden` bin globally makes the `garden` command start the server and open the console in a Chrome app window. See the design spec (§8, §9) for the CLI and build shape.

For UI work, skip the build. Run `pnpm dev:sandbox:server` in one terminal and `pnpm dev:sandbox:web` in another, then open the URL vite prints. The sandbox is a second, fully isolated garden instance — its own port, tmux socket, app dir, and transcripts dir — so it runs concurrently with an installed `garden` without either one reaching the other's sessions or state. `dev:sandbox:server` runs the server from TypeScript source and writes no pid file, so `garden stop` will not reach it — Ctrl-C stops it. `dev:sandbox:web` serves the client with HMR and proxies the API routes and both WebSockets to the sandbox server, whichever port it's running on.

## Where to start

- `docs/specs/2026-09-03-garden-v1-design.md` — the full design: scope, architecture, and what's deliberately out for v1.
- `docs/README.md` — how the docs are organized.
