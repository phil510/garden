#!/usr/bin/env bash
# Initialize a ship-it pipeline: take the lock, scaffold the state
# directory, write workflow.md from a negotiated brief body.
#
# The brief *content* is the orchestrator's job (it's negotiated
# judgment); this script owns the scaffolding around it.
set -euo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=_common.sh
. "$HERE/_common.sh"

usage() {
  cat <<'EOF'
Usage: pipeline-init.sh --worktree <abs-path> --branch <name>
                        [--brief-file <path>] [--repo <owner/repo>]

--repo is derived from the worktree's origin remote when omitted, and init
fails (exit 2) when it can't be.

Reads the brief body (the header fields plus sections 1-7 of the brief
schema) from --brief-file, or from stdin when --brief-file is omitted.

Creates <worktree>/.ship-it/active (lock), <worktree>/.ship-it/<branch>/
and its events/ subdirectory, writes workflow.md, scaffolds decisions.md,
and writes <worktree>/.ship-it/.gitignore so the state stays out of git status.

Prints JSON: branch, shipitdir, workflow, started.
Exits 3 if another pipeline already holds the lock, 2 if this branch
already has a workflow.md.
EOF
}

WORKTREE='' BRANCH_ARG='' BRIEF_FILE='' REPO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree) WORKTREE="${2-}"; shift 2 ;;
    --branch) BRANCH_ARG="${2-}"; shift 2 ;;
    --brief-file) BRIEF_FILE="${2-}"; shift 2 ;;
    --repo) REPO="${2-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; usage_die "unknown argument: $1" ;;
  esac
done

[ -n "$WORKTREE" ] || { usage >&2; usage_die 'missing --worktree'; }
[ -n "$BRANCH_ARG" ] || { usage >&2; usage_die 'missing --branch'; }
[ -d "$WORKTREE" ] || die "worktree not found: $WORKTREE"

BRIEF_BODY=''
if [ -n "$BRIEF_FILE" ]; then
  [ -f "$BRIEF_FILE" ] || die "brief file not found: $BRIEF_FILE"
  BRIEF_BODY=$(cat -- "$BRIEF_FILE")
else
  [ ! -t 0 ] || { usage >&2; usage_die 'no --brief-file and stdin is a tty'; }
  BRIEF_BODY=$(cat)
fi
[ -n "${BRIEF_BODY//[[:space:]]/}" ] || die 'brief body is empty'

SHIPITROOT="$WORKTREE/.ship-it"
LOCK="$SHIPITROOT/active"
BRANCH="$BRANCH_ARG"
SHIPITDIR="$SHIPITROOT/$BRANCH"
WORKFLOW="$SHIPITDIR/workflow.md"

mkdir -p "$SHIPITROOT"
[ -e "$SHIPITROOT/.gitignore" ] || printf '*\n' > "$SHIPITROOT/.gitignore"

# Atomic lock acquisition: noclobber makes the create-or-fail one syscall.
if ! (set -o noclobber; printf '%s\n' "$BRANCH" > "$LOCK") 2>/dev/null; then
  existing=$(head -n 1 "$LOCK" 2>/dev/null | tr -d '\r' || true)
  if [ "$existing" = "$BRANCH" ]; then
    die "pipeline already active for this branch ('$BRANCH') — resume or abort it first" 3
  fi
  die "another pipeline is active in this worktree (branch '$existing') — resume or abort it first" 3
fi
LOCK_OURS=1
cleanup() {
  if [ "${LOCK_OURS:-0}" = 1 ]; then rm -f "$LOCK"; fi
}
trap 'cleanup' EXIT

[ ! -f "$WORKFLOW" ] || die "workflow.md already exists for '$BRANCH': $WORKFLOW"

mkdir -p "$SHIPITDIR/events"

if [ -z "$REPO" ]; then
  origin=$(git -C "$WORKTREE" remote get-url origin 2>/dev/null || true)
  # git@host:owner/repo.git and https://host/owner/repo.git both reduce to owner/repo
  REPO=$(printf '%s' "$origin" | sed -E 's#\.git$##; s#^.*[:/]([^/:]+/[^/]+)$#\1#')
  # garden watch needs a real owner/repo; fail here rather than mid-pipeline.
  [ -n "$REPO" ] || die "cannot derive owner/repo from origin; pass --repo"
fi

STARTED=$(iso_now)
TMP="$WORKFLOW.tmp.$$"
{
  printf '# Workflow — %s\n\n' "$BRANCH"
  printf '**Status:** active\n'
  printf '**Started:** %s\n' "$STARTED"
  printf '**Branch:** %s\n' "$BRANCH"
  printf '**Worktree:** %s\n' "$WORKTREE"
  printf '**Repo:** %s\n' "$REPO"
  printf '**PR:** <populated by developer when stage 2 completes>\n\n'
  printf -- '---\n\n'
  printf '## Brief\n\n'
  printf '%s\n\n' "$BRIEF_BODY"
  printf -- '---\n\n'
  printf '## Stages\n'
  printf -- '- [ ] 1. Plan\n'
  printf -- '- [ ] 2. Develop + draft PR\n'
  printf -- '- [ ] 3. Internal review\n'
  printf -- '- [ ] 4. Finish\n\n'
  printf '## Annotations\n'
  printf '(append-only, written by workers and orchestrator. Annotations are\n'
  printf 'appended flat and chronological at the end of this section — never\n'
  printf "inserted under a stage's checkbox line.)\\n\\n"
  printf '> NOTE %s — orchestrator: pipeline initialized\n' "$STARTED"
} > "$TMP"
mv -- "$TMP" "$WORKFLOW"

DECISIONS="$SHIPITDIR/decisions.md"
DTMP="$DECISIONS.tmp.$$"
{
  printf '# Decisions — %s\n\n' "$BRANCH"
  printf 'Append-only log of two kinds of entry: gates auto-resolved instead of escalating, and\n'
  printf 'limitations the reviewer accepted. Each records what was decided, what settled it,\n'
  printf 'and which doc or finding backs it.\n\n'
  printf '<!-- Entries go below, one per auto-resolved gate or accepted limitation. Each starts at column 0\n'
  printf 'with a bare ISO timestamp, then " — <actor>: <decision>".\n'
  printf 'e.g. 2026-09-12T14:03:00Z — planner: interpreted "the settings panel" as the existing web/settings route, not a new one. -->\n'
} > "$DTMP"
mv -- "$DTMP" "$DECISIONS"

LOCK_OURS=0
trap - EXIT

printf '{"branch":"%s","shipitdir":"%s","workflow":"%s","started":"%s"}\n' \
  "$(jesc "$BRANCH")" "$(jesc "$SHIPITDIR")" "$(jesc "$WORKFLOW")" "$(jesc "$STARTED")"
