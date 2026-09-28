#!/usr/bin/env bash
# SessionStart(compact) hook: after compaction wipes context, inject the compaction-status
# file warn.sh asked the agent to write before it happened, and reset the marker so the next
# 175K crossing warns again.
#
# The hooks.json matcher already restricts this to firing only on a post-compaction
# SessionStart, so there is no need to re-check the start reason here.
shopt -s nullglob

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

# Same dual resolution as warn.sh — the field-first, glob-fallback approach — so both scripts
# always agree on which scratchpad directory the marker and status file live in.
scratchpad_dir=$(printf '%s' "$input" | jq -r '.scratchpad_dir // empty' 2>/dev/null)
if [ -z "$scratchpad_dir" ]; then
  session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
  if [ -n "$session_id" ]; then
    # GARDEN_HOOKS_GLOB_ROOT lets tests point this at a hermetic directory instead of the real
    # /private/tmp; unset in production, where the default is the real scratchpad root.
    glob_root=${GARDEN_HOOKS_GLOB_ROOT:-/private/tmp}
    for candidate in "$glob_root"/claude-*/*/"$session_id"/scratchpad; do
      [ -d "$candidate" ] || continue
      scratchpad_dir=$candidate
      break
    done
  fi
fi
[ -n "$scratchpad_dir" ] && [ -d "$scratchpad_dir" ] || exit 0

status_file="$scratchpad_dir/compaction-status.md"

# Skills named earlier in the session are the easiest thing for a summary to drop. One line, no
# blank lines, so it sits inside the status-file preamble.
skills_directive='Re-check the available skills now and invoke every one that matches your task, including any the user named earlier in this session, whether or not they appear below or in your resumed summary. Compaction does not cancel an earlier instruction to use a skill.'

if [ ! -f "$status_file" ]; then
  echo "Compaction happened, but no \`compaction-status.md\` was written before it, so there is no on-disk summary of your prior state. Whatever summary Claude Code itself resumed you with is still just claims, not settled fact: check them against the repo before acting on them."
  echo "$skills_directive"
else
  cat <<'EOF'
Compaction happened. The section below is what you wrote about your own state just before it —
treat it as a set of claims, not settled fact: check them against the repo and the workstream
files it points to before acting on them, since the world may have moved since you wrote it.
EOF
  echo "$skills_directive"
  echo
  # Hook stdout is capped at 10,000 characters as a whole; leave room for the preamble.
  head -c 9000 "$status_file"
fi

# Reset the marker in both the found and not-found cases, so the next 175K crossing warns
# again regardless of whether this compaction had a status file to recover.
rm -f "$scratchpad_dir/.compaction-warned"

exit 0
