#!/usr/bin/env bash
# Shared helpers for the ship-it pipeline scripts.
# Sourced, never executed directly.
#
# Exit-code convention across all ship-it scripts:
#   0  success
#   1  usage error
#   2  state error (missing pipeline, missing workflow.md, bad value)
#   3  lock conflict (another pipeline is active)

die() {
  local code="${2:-2}"
  printf 'error: %s\n' "$1" >&2
  exit "$code"
}

usage_die() {
  printf '%s\n' "$1" >&2
  exit 1
}

iso_now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# Escape a string as the body of a JSON string literal.
# Drops control characters, escapes backslash + quote, joins lines with \n.
jesc() {
  printf '%s' "${1-}" \
    | tr -d '\000-\010\013\014\016-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | awk 'BEGIN { ORS = "" } NR > 1 { print "\\n" } { print }'
}

# Parse an ISO-8601 UTC timestamp to epoch seconds. Empty output on failure.
# Tries GNU date first, then BSD/macOS date.
iso_to_epoch() {
  local iso="$1" out
  out=$(date -u -d "$iso" '+%s' 2>/dev/null) || out=''
  case "$out" in
    '' | *[!0-9]*) out=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" '+%s' 2>/dev/null) || out='' ;;
  esac
  case "$out" in
    '' | *[!0-9]*) printf '' ;;
    *) printf '%s' "$out" ;;
  esac
}

human_duration() {
  local s="$1"
  [ -n "$s" ] || { printf 'unknown'; return; }
  printf '%dh%02dm' "$((s / 3600))" "$(((s % 3600) / 60))"
}

# Read a `**Field:** value` line out of workflow.md.
workflow_field() {
  local file="$1" field="$2"
  sed -n "s/^\*\*${field}:\*\*[[:space:]]*//p" "$file" | head -n 1
}

# Resolve WORKTREE/BRANCH into SHIPITROOT, LOCK, SHIPITDIR, WORKFLOW.
# Branch falls back to whatever the `active` lock names.
# shellcheck disable=SC2034  # these globals are consumed by the sourcing script
resolve_pipeline() {
  local worktree="$1" branch="${2-}"
  [ -n "$worktree" ] || usage_die 'missing --worktree'
  [ -d "$worktree" ] || die "worktree not found: $worktree"

  SHIPITROOT="$worktree/.ship-it"
  LOCK="$SHIPITROOT/active"

  if [ -z "$branch" ]; then
    [ -f "$LOCK" ] || die "no active pipeline in $SHIPITROOT (pass --branch to target a specific one)"
    branch=$(head -n 1 "$LOCK" | tr -d '\r')
    [ -n "$branch" ] || die "lock file is empty: $LOCK"
  fi

  BRANCH="$branch"
  SHIPITDIR="$SHIPITROOT/$BRANCH"
  WORKFLOW="$SHIPITDIR/workflow.md"
}

# Strip the leading ISO timestamp off an event filename to get its kind.
# Falls back to the whole basename when the name doesn't match the scheme.
event_kind() {
  local base="$1" kind
  kind=$(printf '%s' "$base" \
    | sed -E 's/\.md$//; s/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?-//')
  printf '%s' "${kind:-$base}"
}

# Count `fix` dispositions under an event file's ## Reviewer classification.
count_fix_findings() {
  awk '/^## Reviewer classification/ { in_c = 1; next }
       /^## / { in_c = 0 }
       in_c && /^\*\*Disposition:\*\*[[:space:]]*fix([[:space:]]|$)/ { n++ }
       END { print n + 0 }' "$1"
}
