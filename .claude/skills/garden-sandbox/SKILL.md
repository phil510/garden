---
name: garden-sandbox
description: Run an isolated garden sandbox and test a change in the real app, including capturing screenshots of the running UI via headless Chrome DevTools Protocol. Use for "run a sandbox", "test this in garden", "try it in the app", "run the app", "screenshot the app", "show me how this looks", "verify this UI change", "review a visual change", or any time a garden change needs checking in the running app, or a UI diff needs visual confirmation before or after implementing it.
---

# garden sandbox

Reading source tells you what the code says, not what garden does. To check a change you run it:
boot a sandbox of your own, drive it, and look at the result. You cannot see CSS, layout, or
rendering by reading source, so screenshots are how you look at it the way a human reviewer would.

## The sandbox

A garden server must be running against real tmux. Start a sandbox yourself rather than asking
the user for one. `docs/testing.md` ("Running a sandbox") has the start and stop sequence, and
explains why the port, socket and app dir must be your own. Target the user's real `garden` only
when the real instance is specifically what's under test, and then point at it; don't run it.

`pnpm screenshot` never boots a server. If it reports the server unreachable, the sandbox isn't up
yet or has died, so check the sandbox's output.

Put `GARDEN_PORT=<sandbox port>` on every `pnpm screenshot` call. Shell state doesn't carry
between calls, and inside a garden session `GARDEN_PORT` already names the real instance, so a
call without it captures the user's real garden. A drag there writes to their state (see the
risk tiers below).

`GARDEN_PORT` is also the proxy target of the vite each run starts. A `"port"` override in
`~/.garden/config.json` is a separate mechanism `pnpm screenshot` does not read — on a config-only custom
port it reports the server as unreachable when it is in fact running fine. Check the user's
config before believing that message.

### Blank terminals mean the panes are attached elsewhere

A session accepts one attach at a time, so if another client has the same session open, `pnpm screenshot`'s
attach is refused and those panes screenshot as empty black rectangles. Everything
outside the terminals — sidebar, file panel, pane headers, borders, empty slots, layout — is
still accurate, so that is only a problem when the change you are checking is about terminal
content itself. Against the sandbox this rarely comes up, since nothing else is normally attached
to it; against a real instance, ask the user to close their garden window for a moment — the
server and the tmux sessions keep running, and the attach frees up. A garden window left open in
the 9222 Chrome (older versions of `pnpm screenshot` launched one) holds an attach too; quit that Chrome
to free it.

### Driving a real instance is live, not contained

This only applies when `GARDEN_PORT` points at the user's real instance rather than the
sandbox. The Chrome window `pnpm screenshot` controls talks to the same garden server the user's own
browser does, so nothing you do in it is contained. It can drag but never types, so against
a real instance the blast radius is the second tier below; the three tiers are:

- **Typing into an attached pane is the dangerous one.** Keystrokes go straight through to the
  real pty, which is the user's actual running Claude Code session or shell. There is no
  sandbox and no undo — you would be typing into their session.
- **Dragging stage or sidebar chrome persists server-side.** Preset, slots, layout,
  group order, pins, collapsed repos and the dead-session filter are written to disk and shared,
  so they change what the user sees in their own window. Run such drags against the sandbox.
- **Panel resizes, scrolling and expanding file-tree nodes are client-local** and harmless — they never leave
  this browser.

None of this applies against the sandbox. Its panes run the fake Claude, not a real Claude Code
session or shell, so there is no real pty to type into; and its chrome-persistence writes land in
the sandbox's own state (`~/.garden-sandbox/config.json` by default), not the user's real config,
so there is no real user state to disturb.

## Screenshotting

### Taking a screenshot

```
pnpm screenshot [--path <url path>] [--out <name>] [--width <n>] [--height <n>] [--wait <ms>]
                [--drag <css selector> --drag-by <dx>,<dy>]
```

Defaults: `--path /` (the whole app), 1600x1000, `--out screenshot`, `--wait 300`. Each run
starts its own vite dev server from this checkout on a free port and stops it (pnpm and vite
together) when the run ends, whether it succeeds, fails or is interrupted, so a run leaves no vite
behind. A cold vite costs about half a second, which is why nothing keeps one alive between runs.
The run also needs a debuggable Chrome on port 9222 and launches one if none is answering. That
Chrome is the one process a run leaves running: it is shared by every checkout, so no single run
owns it. Quit it by hand when you want it gone. Each run opens a tab of its own in that Chrome and
closes it on exit, so any other page open on 9222 is never what gets captured. Unknown flags and a lone `--drag` or `--drag-by` exit 1 rather than quietly
producing an undragged screenshot.

The last line of stdout is the absolute path to the saved PNG under `.screenshots/`. **Use the Read
tool on that path** to actually look at the image — running the command alone tells you nothing
about how it looks.

### Driving a drag

`--drag <selector> --drag-by <dx>,<dy>` presses the left button on the centre of the first element
matching the selector, moves in ten steps, and releases, as real `Input.dispatchMouseEvent` input.
The app's own pointer handlers and clamps decide where the drag ends up, which is the evidence
you want: injecting state only proves the renderer can draw that state, not that the interaction
produces it. The run logs the from/to coordinates and fails if nothing visible matches the selector.

`querySelector` returns the first match, and `.resize-handle` has two (sidebar and file panel), so
pick one on purpose:

```
pnpm screenshot --out sidebar-wide --drag '.sidebar + .resize-handle' --drag-by 60,0
pnpm screenshot --out panel-wide --drag '.stage-wrap + .resize-handle' --drag-by -80,0
```

The drag happens in the run's own tab and that tab is closed afterwards. Panel widths are
in-memory, so the drag shows only in that run's PNG and the next plain screenshot is back to the
default. A change a screenshot has to show after a drag therefore has to be driven in the same run.

### Iterating on a visual change

The client code in the frame is always this checkout's working tree, because the vite serving it
was started from this checkout for this run alone. Branch-specific content visible in the frame
still isn't proof that a change took effect, since `main` can render an identical frame (a new
preset or empty-slot placeholder looks the same on both). Pick states whose rendering differs
between the base and your change.

Screenshot before you touch anything to see the current state, make the change, screenshot again,
and compare. For a ticket about a visual bug, a before/after screenshot pair is what you attach as
evidence in the PR — not just a description of the CSS you changed.
