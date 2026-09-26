#!/usr/bin/env bash
# Prepare .handoffs/ and print the path to write today's handoff to.
# Usage: init-handoff.sh <topic-slug>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $(basename "$0") <topic-slug>" >&2
  exit 2
fi

slug=$(printf '%s' "$1" | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-')
if [[ -z $slug ]]; then
  echo "error: topic slug is empty after normalization" >&2
  exit 2
fi

root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
mkdir -p "$root/.handoffs"

# Handoffs are local session context, never committed. Skip if an existing
# gitignore rule (repo-local or global) already covers the directory.
if ! git -C "$root" check-ignore -q .handoffs 2>/dev/null; then
  printf '\n.handoffs/\n' >>"$root/.gitignore"
  echo "note: added .handoffs/ to $root/.gitignore" >&2
fi

echo "$root/.handoffs/$(date +%F)-$slug.md"
