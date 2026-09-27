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

# Shared with plugins/garden/hooks/scripts/warn.sh, which mirrors this same occupancy
# definition — resolved relative to this script's own location so it still finds the filter
# from the installed plugin cache, regardless of the caller's cwd.
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
usage_filter_file="$script_dir/../../../lib/usage-filter.jq"
[ -f "$usage_filter_file" ] || die "usage filter not found at $usage_filter_file"

arg=$1
if [ -f "$arg" ]; then
  transcript=$arg
else
  transcript=$(find "${HOME}/.claude/projects" -name "${arg}.jsonl" -print -quit 2>/dev/null || true)
  [ -n "$transcript" ] || die "no transcript found for session $arg"
fi

turns=$(jq -r -f "$usage_filter_file" "$transcript" 2>/dev/null) ||
  die "could not read $transcript as JSON lines"

tokens=$(printf '%s\n' "$turns" | tail -1)

[ -n "$tokens" ] || die "no assistant turns yet in $transcript"
echo "$tokens"
