#!/usr/bin/env bash
# Close out a pipeline: flip Status, annotate, release the lock, and
# return the numbers the completion summary needs.
#
# Stop live workers, and on an abort run `garden unwatch`, *before* running
# this — this script only touches disk.
set -euo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=_common.sh
. "$HERE/_common.sh"

usage() {
  cat <<'EOF'
Usage: pipeline-finish.sh --worktree <abs-path> --status completed|aborted
                          [--branch <name>] [--note <text>]

Branch defaults to whatever <worktree>/.ship-it/active names.

Flips workflow.md's **Status:**, appends a `> NOTE` annotation, and removes
the lock (only when it names this branch — a lock held by a different
pipeline is left alone).

Prints JSON: branch, status, pr_url, started, ended, duration_seconds,
duration_human, review_rounds, escalations{annotated,open,open_files[]},
events_total, decisions_entries, lock_released, unrouted_candidates[].

escalations.annotated counts `> ESCALATED` lines; escalations.open counts
escalation event files with no `## Resolution` section.

escalations.open_files lists those open escalation event files (file,
kind) so a caller can act on them without a second pass over events/.

decisions_entries counts timestamped entries in decisions.md.

unrouted_candidates is derived, not authoritative: PR-activity events
whose work stopped short — `reason: unclassified` (no `## Reviewer
classification` and no `## Resolution`), or `reason: fix-unrouted` (a
classification with `fix` findings but no `## Developer round`). Verify
before putting them in the user-facing summary.
EOF
}

WORKTREE='' BRANCH_ARG='' NEW_STATUS='' NOTE=''
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree) WORKTREE="${2-}"; shift 2 ;;
    --branch) BRANCH_ARG="${2-}"; shift 2 ;;
    --status) NEW_STATUS="${2-}"; shift 2 ;;
    --note) NOTE="${2-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; usage_die "unknown argument: $1" ;;
  esac
done

case "$NEW_STATUS" in
  completed | aborted) : ;;
  '') usage >&2; usage_die 'missing --status (completed|aborted)' ;;
  *) usage_die "--status must be 'completed' or 'aborted', got '$NEW_STATUS'" ;;
esac

resolve_pipeline "$WORKTREE" "$BRANCH_ARG"
[ -f "$WORKFLOW" ] || die "no workflow.md for branch '$BRANCH': $WORKFLOW"

ENDED=$(iso_now)
STARTED=$(workflow_field "$WORKFLOW" 'Started')
PR_URL=$(workflow_field "$WORKFLOW" 'PR')
case "$PR_URL" in '<'*) PR_URL='' ;; esac

DURATION=''
if [ -n "$STARTED" ]; then
  s_epoch=$(iso_to_epoch "$STARTED")
  e_epoch=$(iso_to_epoch "$ENDED")
  if [ -n "$s_epoch" ] && [ -n "$e_epoch" ]; then DURATION=$((e_epoch - s_epoch)); fi
fi

# --- flip status + annotate (single atomic rewrite) ---
# A repeat run with the status already set writes nothing, so the finish step is safe to rerun.
if [ "$(workflow_field "$WORKFLOW" 'Status')" != "$NEW_STATUS" ]; then
  TMP="$WORKFLOW.tmp.$$"
  sed "s/^\*\*Status:\*\*.*/**Status:** ${NEW_STATUS}/" "$WORKFLOW" > "$TMP"
  if [ -n "$NOTE" ]; then
    printf '> NOTE %s — orchestrator: pipeline %s; %s\n' "$ENDED" "$NEW_STATUS" "$NOTE" >> "$TMP"
  else
    printf '> NOTE %s — orchestrator: pipeline %s\n' "$ENDED" "$NEW_STATUS" >> "$TMP"
  fi
  mv -- "$TMP" "$WORKFLOW"
fi

# --- tallies ---
shopt -s nullglob
rounds=("$SHIPITDIR"/review-round-*.md)
review_rounds=${#rounds[@]}

# Scoped to the ## Annotations section for the same reason pipeline-status.sh
# scopes its annotation read: the brief body above it is free user prose.
esc_total=$(sed -n '/^## Annotations/,$p' "$WORKFLOW" 2>/dev/null \
  | grep -c '^> ESCALATED' || true)
: "${esc_total:=0}"

decisions_entries=$(grep -cE '^[[:space:]]*([-*][[:space:]]+)?[0-9]{4}-[0-9]{2}-[0-9]{2}T' "$SHIPITDIR/decisions.md" 2>/dev/null || true)
: "${decisions_entries:=0}"

# `open` is counted from escalation event files, not from `> RESOLVED`
# annotations: RESOLVED is overloaded (it also marks a brief edit with no
# escalation behind it), so annotation arithmetic under-reports open ones.
events_total=0 esc_open=0 open_files_json='' osep='' unrouted_json='' usep=''
for f in "$SHIPITDIR"/events/*.md; do
  events_total=$((events_total + 1))
  base=$(basename -- "$f")
  kind=$(event_kind "$base")
  case "$kind" in
    *escalation*)
      if ! grep -q '^## Resolution' "$f"; then
        esc_open=$((esc_open + 1))
        open_files_json="${open_files_json}${osep}{\"file\":\"$(jesc "$base")\",\"kind\":\"$(jesc "$kind")\"}"
        osep=','
      fi
      ;;
  esac
  case "$kind" in
    activity) : ;;
    *) continue ;;
  esac
  if grep -q '^## Reviewer classification' "$f"; then
    if grep -q '^## Developer round' "$f"; then continue; fi
    if [ "$(count_fix_findings "$f")" -eq 0 ]; then continue; fi
    reason='fix-unrouted'
  elif grep -q '^## Resolution' "$f"; then
    continue
  else
    reason='unclassified'
  fi
  unrouted_json="${unrouted_json}${usep}{\"file\":\"$(jesc "$base")\",\"kind\":\"$(jesc "$kind")\",\"reason\":\"${reason}\"}"
  usep=','
done
shopt -u nullglob

# --- release the lock only if it's ours ---
lock_released='false'
if [ -f "$LOCK" ]; then
  held=$(head -n 1 "$LOCK" | tr -d '\r')
  if [ "$held" = "$BRANCH" ]; then
    rm -f "$LOCK"
    lock_released='true'
  fi
fi

printf '{"branch":"%s","status":"%s","pr_url":"%s","started":"%s","ended":"%s","duration_seconds":%s,"duration_human":"%s","review_rounds":%s,"escalations":{"annotated":%s,"open":%s,"open_files":[%s]},"events_total":%s,"decisions_entries":%s,"lock_released":%s,"unrouted_candidates":[%s]}\n' \
  "$(jesc "$BRANCH")" "$(jesc "$NEW_STATUS")" "$(jesc "$PR_URL")" \
  "$(jesc "$STARTED")" "$(jesc "$ENDED")" \
  "${DURATION:-null}" "$(human_duration "$DURATION")" \
  "$review_rounds" "$esc_total" "$esc_open" "$open_files_json" \
  "$events_total" "$decisions_entries" "$lock_released" "$unrouted_json"
