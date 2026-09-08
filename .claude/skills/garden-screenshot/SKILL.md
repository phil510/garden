---
name: garden-screenshot
description: Capture a real screenshot of garden's running UI via headless Chrome DevTools Protocol, so an agent can look at its own visual changes instead of guessing from source. Use for "screenshot the app", "show me how this looks", "verify this UI change", "review a visual change", or any time a garden UI diff needs visual confirmation before or after implementing it.
---

# garden screenshot

You cannot see CSS, layout, or rendering by reading source — you can only see it by looking at a
screenshot. This tool renders garden's actual browser UI and saves a PNG so you can inspect it
the same way a human reviewer would, and iterate before handing off a visual change.

## Prerequisite

A garden server must already be running against real tmux. Either the `garden` CLI or
`pnpm dev:sandbox:server` satisfies this — they boot the same server the same way. This tool never boots
one itself; reusing what is already running is the point, so if `pnpm screenshot` reports the
server unreachable, ask the user to start garden rather than starting it yourself.

The tool assumes garden's default port, 4310. That port is configurable (`GARDEN_PORT`, or
`"port"` in `~/.garden/config.json`) and neither this tool nor the vite dev server it spawns
reads that config, so on a custom port the tool reports the server as unreachable when it is
in fact running fine. Check the user's config before believing the message.

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

A session accepts one attach at a time, so if the user has garden open on the same session, this
client's attach is refused and those panes screenshot as empty black rectangles. Everything
outside the terminals — sidebar, file panel, pane headers, borders, empty slots, layout — is
still accurate, so that is only a problem when the change you are checking is about terminal
content itself. When it is, ask the user to close their garden window for a moment; the server
and the tmux sessions keep running, and the attach frees up.

## Warning: the page you are driving is live, not a sandbox

The Chrome window this tool controls talks to the same garden server the user's own browser
does, so nothing you do in it is contained. This tool only captures screenshots. If you ever
extend it to script interactions, the blast radius rises sharply in three tiers:

- **Typing into an attached pane is the dangerous one.** Keystrokes go straight through to the
  real pty, which is the user's actual running Claude Code session or shell. There is no
  sandbox and no undo — you would be typing into their session.
- **Clicking and dragging stage or sidebar chrome persists server-side.** Preset, slots, layout,
  group order, pins, collapsed repos and the dead-session filter are written to disk and shared,
  so they change what the user sees in their own window.
- **Scrolling and expanding file-tree nodes are client-local** and harmless — they never leave
  this browser.
