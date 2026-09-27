#!/usr/bin/env bash
# PostToolUse hook: once per compaction cycle, when the main session's context reaches 175K
# tokens, ask the agent to write a compaction-status file the SessionStart(compact) recovery
# hook (recover.sh) can inject back in after compaction happens.
#
# Every guard below is an early, silent `exit 0` — a hook that fails the session over a
# missing tool or an unreadable transcript is worse than one that occasionally stays quiet.
shopt -s nullglob

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

# A subagent's tool call carries the parent's session_id/transcript_path; agent_id is present
# only inside a subagent, so this is what tells the two apart.
agent_id=$(printf '%s' "$input" | jq -r '.agent_id // empty' 2>/dev/null)
[ -n "$agent_id" ] && exit 0

# Prefer the documented scratchpad_dir input field; fall back to the glob for an older CLI or
# any case where the harness omits it. Both this script and recover.sh resolve the same way,
# so the marker they read and write always agrees on which directory it means.
scratchpad_dir=$(printf '%s' "$input" | jq -r '.scratchpad_dir // empty' 2>/dev/null)
if [ -z "$scratchpad_dir" ]; then
  session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
  if [ -n "$session_id" ]; then
    for candidate in /private/tmp/claude-*/*/"$session_id"/scratchpad; do
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

# Occupancy is the last assistant turn's usage, not a sum over turns — see
# skills/orchestrate-sessions/scripts/context_tokens.sh, which this mirrors.
usage_filter='
  select(.type == "assistant" and .message.usage != null)
  | .message.usage
  | (.input_tokens // 0)
    + (.cache_creation_input_tokens // 0)
    + (.cache_read_input_tokens // 0)
    + (.output_tokens // 0)
'

last_usage_in() {
  jq -r "$usage_filter" 2>/dev/null | tail -n 1
}

# This hook runs on every tool call, so read only the transcript's tail rather than the whole
# file. But a bounded tail is an unverified assumption about how large one assistant turn's
# JSONL line can get, and if the window is ever too small it must not silently read as "no
# tokens found yet" — that would make the warning permanently and invisibly dead. So a tail
# that yields nothing gets one retry against the whole file before this concludes there is
# genuinely no assistant turn yet.
tokens=$(tail -n 50 "$transcript" 2>/dev/null | last_usage_in)
if [ -z "$tokens" ]; then
  tokens=$(last_usage_in < "$transcript")
fi
[ -n "$tokens" ] || exit 0

case "$tokens" in
  '' | *[!0-9]*) exit 0 ;;
esac
[ "$tokens" -ge 175000 ] || exit 0

touch "$marker"

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: (
      "Context is at or past 175K tokens; compaction may happen soon. Before doing more work, " +
      "write (or overwrite) `compaction-status.md` in your scratchpad directory, capped at " +
      "roughly 40 lines: the goal you are working toward, the key decisions made so far and " +
      "why, the current state, the concrete next step, and pointers to durable workstream " +
      "files (plan, spec, ticket, PR) rather than a log of what happened. This file is what " +
      "gets restored after compaction, so write it for a reader with no memory of this " +
      "conversation."
    )
  }
}'
