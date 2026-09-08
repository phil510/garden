#!/usr/bin/env bash
# One JSON snapshot of pipeline state, read off disk.
#
# Use for: /plant resume, a bare teammate-terminated (mid-stage death),
# and a user status request — i.e. the cases where the worker's message
# isn't available or isn't trusted.
set -euo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=_common.sh
. "$HERE/_common.sh"

usage() {
  cat <<'EOF'
Usage: pipeline-status.sh --worktree <abs-path> [--branch <name>]
                          [--annotations <n>]

Branch defaults to whatever <worktree>/.plant/active names.
--annotations sets how many trailing annotation lines to include (default 5).

Prints JSON: branch, status, pr_url, started, plantdir, workflow,
stages[], current_stage, open_escalations[], review_rounds, artifacts{},
events[], annotations[].

Each events[] entry reports resolved so the caller can tell open
escalations from closed ones without reading files.
EOF
}

WORKTREE='' BRANCH_ARG='' ANNOT_N=5
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree) WORKTREE="${2-}"; shift 2 ;;
    --branch) BRANCH_ARG="${2-}"; shift 2 ;;
    --annotations) ANNOT_N="${2-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; usage_die "unknown argument: $1" ;;
  esac
done
case "$ANNOT_N" in '' | *[!0-9]*) usage_die '--annotations must be a non-negative integer' ;; esac

resolve_pipeline "$WORKTREE" "$BRANCH_ARG"
[ -f "$WORKFLOW" ] || die "no workflow.md for branch '$BRANCH': $WORKFLOW"

STATUS=$(workflow_field "$WORKFLOW" 'Status')
PR_URL=$(workflow_field "$WORKFLOW" 'PR')
STARTED=$(workflow_field "$WORKFLOW" 'Started')
case "$PR_URL" in '<'*) PR_URL='' ;; esac

# --- stages ---
stages_json='' current_stage='null' sep=''
while IFS= read -r line; do
  case "$line" in
    '- ['*) : ;;
    *) continue ;;
  esac
  mark=${line:3:1}
  rest=${line:6}
  num=${rest%%.*}
  title=${rest#*. }
  case "$num" in '' | *[!0-9]*) continue ;; esac
  if [ "$mark" = 'x' ] || [ "$mark" = 'X' ]; then
    done_val='true'
  else
    done_val='false'
    [ "$current_stage" = 'null' ] && current_stage="$num"
  fi
  stages_json="${stages_json}${sep}{\"n\":${num},\"title\":\"$(jesc "$title")\",\"done\":${done_val}}"
  sep=','
done < <(sed -n '/^## Stages/,/^## Annotations/p' "$WORKFLOW")

# --- review rounds + artifacts ---
shopt -s nullglob
rounds=("$PLANTDIR"/review-round-*.md)
review_rounds=${#rounds[@]}

artifact_bool() {
  if [ -f "$PLANTDIR/$1" ]; then printf 'true'; else printf 'false'; fi
}
artifacts_json=$(printf '{"plan":%s,"decisions":%s}' \
  "$(artifact_bool plan.md)" \
  "$(artifact_bool decisions.md)")

# --- events ---
events_json='' esc_json='' esep='' ssep=''
for f in "$PLANTDIR"/events/*.md; do
  base=$(basename -- "$f")
  kind=$(event_kind "$base")
  resolved='false'
  # if/fi rather than `&&`: under `set -e` a trailing failed `&&` list exits.
  if grep -q '^## Resolution' "$f"; then resolved='true'; fi
  events_json="${events_json}${esep}{\"file\":\"$(jesc "$base")\",\"kind\":\"$(jesc "$kind")\",\"resolved\":${resolved}}"
  esep=','
  case "$kind" in
    *escalation*)
      if [ "$resolved" = 'false' ]; then
        esc_json="${esc_json}${ssep}\"$(jesc "$base")\""
        ssep=','
      fi
      ;;
  esac
done
shopt -u nullglob

# --- trailing annotations ---
annot_json='' asep=''
if [ "$ANNOT_N" -gt 0 ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    annot_json="${annot_json}${asep}\"$(jesc "$line")\""
    asep=','
  # Scope to the ## Annotations section: the brief body above it is free user
  # prose, and a stray markdown blockquote there is not a pipeline annotation.
  done < <(sed -n '/^## Annotations/,$p' "$WORKFLOW" 2>/dev/null \
    | grep '^>' | tail -n "$ANNOT_N" || true)
fi

printf '{"branch":"%s","status":"%s","pr_url":"%s","started":"%s","plantdir":"%s","workflow":"%s","current_stage":%s,"review_rounds":%s,"stages":[%s],"open_escalations":[%s],"artifacts":%s,"events":[%s],"annotations":[%s]}\n' \
  "$(jesc "$BRANCH")" "$(jesc "$STATUS")" "$(jesc "$PR_URL")" "$(jesc "$STARTED")" \
  "$(jesc "$PLANTDIR")" "$(jesc "$WORKFLOW")" \
  "$current_stage" "$review_rounds" \
  "$stages_json" "$esc_json" "$artifacts_json" "$events_json" "$annot_json"
