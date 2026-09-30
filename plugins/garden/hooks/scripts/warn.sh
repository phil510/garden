#!/usr/bin/env bash
# PostToolUse / UserPromptSubmit / Stop hook: once per compaction cycle, when the main session's
# context reaches 175K tokens, ask the agent to write a compaction-status file the
# SessionStart(compact) recovery hook (recover.sh) can inject back in after compaction happens.
#
# Whichever registered event first sees the crossing delivers the warning and sets the marker.
# Only events that can carry `additionalContext` are allowed: an event that can't deliver the
# warning must not set the marker, or it would silence the ones that can.
#
# Every guard below is an early, silent `exit 0` — a hook that fails the session over a
# missing tool or an unreadable transcript is worse than one that occasionally stays quiet.
shopt -s nullglob

command -v jq >/dev/null 2>&1 || exit 0

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
usage_filter_file="$script_dir/../../lib/usage-filter.jq"

input=$(cat)

# A subagent's tool call carries the parent's session_id/transcript_path; agent_id is present
# only inside a subagent, so this is what tells the two apart.
agent_id=$(printf '%s' "$input" | jq -r '.agent_id // empty' 2>/dev/null)
[ -n "$agent_id" ] && exit 0

event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null)
case "$event" in
  PostToolUse | UserPromptSubmit | Stop) ;;
  *) exit 0 ;;
esac

# Prefer the documented scratchpad_dir input field; fall back to the glob for an older CLI or
# any case where the harness omits it. Both this script and recover.sh resolve the same way,
# so the marker they read and write always agrees on which directory it means.
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

marker="$scratchpad_dir/.compaction-warned"
[ -e "$marker" ] && exit 0

transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

# The shared filter emits nothing for a transcript that ends in a compact boundary.
last_usage_in() {
  jq -n -r -f "$usage_filter_file" 2>/dev/null
}

# This hook runs on every tool call, so read only the transcript's tail rather than the whole
# file. But a bounded tail is an unverified assumption about how large one assistant turn's
# JSONL line can get (Claude Code's docs decline to fix the format), so a tail that yields no
# match gets one retry against the whole file before this concludes there is genuinely no
# assistant turn yet, rather than silently reading that as "below threshold".
tokens=$(tail -n 50 "$transcript" 2>/dev/null | last_usage_in)
if [ -z "$tokens" ]; then
  tokens=$(last_usage_in < "$transcript")
fi
[ -n "$tokens" ] || exit 0

# The filter can only ever emit a number, but guard it anyway: a non-numeric
# value reaching the `-ge` test below would make bash print an "integer expression expected"
# diagnostic to stderr, which breaks this hook's exit-0-silently contract even though the exit
# code itself would still be 0.
case "$tokens" in
  *[!0-9]*) exit 0 ;;
esac
[ "$tokens" -ge 175000 ] || exit 0

# On Stop an unset marker would make every turn continue, so a failed touch must stay silent.
touch "$marker" || exit 0

jq -n --arg event "$event" '{
  hookSpecificOutput: {
    hookEventName: $event,
    additionalContext: (
      "Context is at or past 175K tokens; compaction may happen soon. Before doing more work, " +
      "write (or overwrite) `compaction-status.md` in your scratchpad directory, capped at " +
      "roughly 40 lines: the goal you are working toward, the key decisions made so far and " +
      "why, any skills the user called out by name or that you are relying on for this work, " +
      "the current state, the concrete next step, and pointers to durable workstream " +
      "files (plan, spec, ticket, PR) rather than a log of what happened. This file is what " +
      "gets restored after compaction, so write it for a reader with no memory of this " +
      "conversation."
    )
  }
}'
