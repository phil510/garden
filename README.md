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
- tmux — required, not optional. garden has no Windows support, because tmux doesn't run there.

## Setup

```bash
pnpm install
```

That is all: lefthook installs the pre-commit hook itself when its package build script runs, so
there is no separate step. If the hook ever goes missing, `pnpm rebuild lefthook` restores it.

**Pre-commit gate.** lefthook runs typecheck, lint, formatting, and unit tests on every commit. CI runs those plus a workspace build and the integration tier, which needs tmux — so a clean commit is a good signal, not a guarantee of a green PR.

## Dev loop

`pnpm build` builds every package. Linking the `garden` bin globally makes the `garden` command start the server and open the console in a Chrome app window. See the design spec (§8, §9) for the CLI and build shape.

For UI work, skip the build. Run `pnpm dev:server` in one terminal and `pnpm dev:web` in another, then open the URL vite prints. `dev:server` runs the server from TypeScript source and writes no pid file, so `garden stop` will not reach it — Ctrl-C stops it. `dev:web` serves the client with HMR and proxies the API routes and both WebSockets to the server on port 4310, which `packages/web/vite.config.ts` hardcodes to match the server default.

## Where to start

- `docs/specs/2026-09-03-garden-v1-design.md` — the full design: scope, architecture, and what's deliberately out for v1.
- `docs/README.md` — how the docs are organized.
