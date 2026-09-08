---
name: garden-screenshot
description: Capture a real screenshot of garden's running UI via headless Chrome DevTools Protocol, so an agent can look at its own visual changes instead of guessing from source. Use for "screenshot the app", "show me how this looks", "verify this UI change", "review a visual change", or any time a garden UI diff needs visual confirmation before or after implementing it.
---

# garden screenshot

You cannot see CSS, layout, or rendering by reading source — you can only see it by looking at a
screenshot. This tool renders garden's actual browser UI and saves a PNG so you can inspect it
the same way a human reviewer would, and iterate before handing off a visual change.

## Prerequisite

A garden server must already be running against real tmux. Prefer the sandbox: `pnpm
dev:sandbox:server` boots an isolated instance (its own port, tmux socket, app dir and a fake
Claude in place of the real one) that runs alongside the user's real `garden` without either
seeing the other's sessions, so a visual check never risks their live work. Point this tool at
it with `GARDEN_PORT=<sandbox port> pnpm screenshot` — the sandbox script logs the port it
bound on startup. The installed `garden` CLI also satisfies this prerequisite (same server, same
boot path) for when the real instance is specifically what's under test. This tool never boots a
server itself; reusing what is already running is the point, so if `pnpm screenshot` reports the
server unreachable, ask the user to start garden (or the sandbox) rather than starting it
yourself.

`GARDEN_PORT` is read by this tool, the vite dev server it spawns, and its Chrome/vite process
cache, so pointing it at a different port is always a distinct, non-colliding run. A `"port"`
override in `~/.garden/config.json` is a separate mechanism this tool does not read — on a
config-only custom port it reports the server as unreachable when it is in fact running fine.
Check the user's config before believing that message.

## Taking a screenshot

```
pnpm screenshot [--path <url path>] [--out <name>] [--width <n>] [--height <n>] [--wait <ms>]
```

Defaults: `--path /` (the whole app), 1600x1000, `--out screenshot`, `--wait 300`. The tool also ensures a vite
dev server (on a port derived from this checkout's path) and a debuggable Chrome instance (port 9222) exist, spawning either if
missing and leaving both running for the next invocation — later runs are fast.

The last line of stdout is the absolute path to the saved PNG under `.screenshots/`. **Use the Read
tool on that path** to actually look at the image — running the command alone tells you nothing
about how it looks.

## Iterating on a visual change

Screenshot before you touch anything to see the current state, make the change, screenshot again,
and compare. For a ticket about a visual bug, a before/after screenshot pair is what you attach as
evidence in the PR — not just a description of the CSS you changed.

## Blank terminals mean the panes are attached elsewhere

A session accepts one attach at a time, so if another client has the same session open, this
tool's attach is refused and those panes screenshot as empty black rectangles. Everything
outside the terminals — sidebar, file panel, pane headers, borders, empty slots, layout — is
still accurate, so that is only a problem when the change you are checking is about terminal
content itself. Against the sandbox this rarely comes up, since nothing else is normally attached
to it; against a real instance, ask the user to close their garden window for a moment — the
server and the tmux sessions keep running, and the attach frees up.

## Warning: driving a real instance is live, not contained

This only applies when `GARDEN_PORT` points at the user's real instance rather than the
sandbox. The Chrome window this tool controls talks to the same garden server the user's own
browser does, so nothing you do in it is contained. This tool only captures screenshots. If you
ever extend it to script interactions against a real instance, the blast radius rises sharply in
three tiers:

- **Typing into an attached pane is the dangerous one.** Keystrokes go straight through to the
  real pty, which is the user's actual running Claude Code session or shell. There is no
  sandbox and no undo — you would be typing into their session.
- **Clicking and dragging stage or sidebar chrome persists server-side.** Preset, slots, layout,
  group order, pins, collapsed repos and the dead-session filter are written to disk and shared,
  so they change what the user sees in their own window.
- **Scrolling and expanding file-tree nodes are client-local** and harmless — they never leave
  this browser.

None of this applies against the sandbox. Its panes run the fake Claude, not a real Claude Code
session or shell, so there is no real pty to type into; and its chrome-persistence writes land in
the sandbox's own state (`~/.garden-sandbox/config.json` by default), not the user's real config,
so there is no real user state to disturb.
