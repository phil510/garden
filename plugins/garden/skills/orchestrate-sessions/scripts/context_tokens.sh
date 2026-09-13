#!/usr/bin/env bash
# Print a Claude Code session's current context occupancy, in tokens.
#
# Occupancy is the last assistant turn's prompt plus its output — not the sum over every turn,
# which counts the same cached prefix once per turn and runs ~60x higher.
#
# usage: context_tokens.sh <session-id|transcript-path>
set -euo pipefail

die() { echo "context_tokens: $*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: context_tokens.sh <session-id|transcript-path>"
command -v jq >/dev/null || die "jq is not installed"

arg=$1
if [ -f "$arg" ]; then
  transcript=$arg
else
  transcript=$(find "${HOME}/.claude/projects" -name "${arg}.jsonl" -print -quit 2>/dev/null || true)
  [ -n "$transcript" ] || die "no transcript found for session $arg"
fi

tokens=$(jq -r '
  select(.type == "assistant" and .message.usage != null)
  | .message.usage
  | (.input_tokens // 0)
    + (.cache_creation_input_tokens // 0)
    + (.cache_read_input_tokens // 0)
    + (.output_tokens // 0)
' "$transcript" | tail -1)

[ -n "$tokens" ] || die "no assistant turns yet in $transcript"
echo "$tokens"
