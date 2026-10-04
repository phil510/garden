#!/usr/bin/env bash
# Plugin monitor: pipes `garden events --follow` into a garden-spawned session so watch digests
# arrive as turns without the agent starting a Monitor itself.
#
# The plugin is enabled in every Claude session on the machine, and a monitor that exits is dead
# until Claude restarts and wakes the agent with "script failed". So outside a garden session this
# blocks silently instead of exiting — without running `garden` at all, since a missing or older
# `garden` would exit. Inside one it execs, so there is no idle shell in the process tree and the
# CLI's own identity check and lifeline take over.

if [ -z "${GARDEN_SESSION_ID:-}" ]; then
  # CLAUDE_PID is Claude's own pid; the parent is the fallback if the monitor env lacks it.
  owner=${CLAUDE_PID:-$PPID}
  while kill -0 "$owner" 2>/dev/null; do
    sleep 2
  done
  exit 0
fi

exec garden events --follow
