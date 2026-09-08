#!/usr/bin/env bash
# Initialize a plant pipeline: take the lock, scaffold the state
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

--repo is derived from the worktree's origin remote when omitted.

Reads the brief body (markdown for sections 1-7 of the brief schema, i.e.
"### 1. Objective" through "### 7. Merge policy") from --brief-file, or
from stdin when --brief-file is omitted.

Creates <worktree>/.plant/active (lock), <worktree>/.plant/<branch>/
and its events/ subdirectory, writes workflow.md, and scaffolds
decisions.md.

Prints JSON: branch, plantdir, workflow, started.
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

PLANTROOT="$WORKTREE/.plant"
LOCK="$PLANTROOT/active"
BRANCH="$BRANCH_ARG"
PLANTDIR="$PLANTROOT/$BRANCH"
WORKFLOW="$PLANTDIR/workflow.md"

mkdir -p "$PLANTROOT"

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

mkdir -p "$PLANTDIR/events"

if [ -z "$REPO" ]; then
  origin=$(git -C "$WORKTREE" remote get-url origin 2>/dev/null || true)
  # git@host:owner/repo.git and https://host/owner/repo.git both reduce to owner/repo
  REPO=$(printf '%s' "$origin" | sed -E 's#\.git$##; s#^.*[:/]([^/:]+/[^/]+)$#\1#')
fi

STARTED=$(iso_now)
TMP="$WORKFLOW.tmp.$$"
{
  printf '# Workflow — %s\n\n' "$BRANCH"
  printf '**Status:** active\n'
  printf '**Started:** %s\n' "$STARTED"
  printf '**Branch:** %s\n' "$BRANCH"
  printf '**Worktree:** %s\n' "$WORKTREE"
  printf '**Repo:** %s\n' "${REPO:-unknown}"
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

DECISIONS="$PLANTDIR/decisions.md"
DTMP="$DECISIONS.tmp.$$"
{
  printf '# Decisions — %s\n\n' "$BRANCH"
  printf 'Append-only log of gates a worker auto-resolved instead of escalating:\n'
  printf 'what was decided, what settled it, and which doc or finding backs it.\n'
} > "$DTMP"
mv -- "$DTMP" "$DECISIONS"

LOCK_OURS=0
trap - EXIT

printf '{"branch":"%s","plantdir":"%s","workflow":"%s","started":"%s"}\n' \
  "$(jesc "$BRANCH")" "$(jesc "$PLANTDIR")" "$(jesc "$WORKFLOW")" "$(jesc "$STARTED")"
