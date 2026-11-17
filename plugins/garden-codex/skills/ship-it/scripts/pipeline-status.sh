#!/usr/bin/env bash
# One JSON snapshot of pipeline state, read off disk.
#
# Use for: /garden:ship-it resume, a bare teammate-terminated (mid-stage death),
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

Branch defaults to whatever <worktree>/.ship-it/active names.
--annotations sets how many trailing annotation lines to include (default 5).

Prints JSON: branch, status, pr_url, started, shipitdir, workflow,
stages[], current_stage, open_escalations[], review_rounds, artifacts{},
review_loop{}, events[], annotations[].

review_loop{} reports the review-loop worker's phase, its outcome and the
mtime of its state file. outcome is derived: `skipped` when the brief's
`Review loop` field is `none`, `pending` when a loop is named and no state
file exists, `running` while the state's phase is not `done`, else the state
file's own outcome (`passed` or `blocked`). phase and state_mtime are null
without a state file.

Each events[] entry reports classified / fix_findings / has_developer_round /
resolved so the caller can tell routed events from unrouted ones without
reading files. fix_findings counts `**Disposition:** fix` lines under the
event's ## Reviewer classification.
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
rounds=("$SHIPITDIR"/review-round-*.md)
review_rounds=${#rounds[@]}

artifact_bool() {
  if [ -f "$SHIPITDIR/$1" ]; then printf 'true'; else printf 'false'; fi
}
artifacts_json=$(printf '{"plan":%s,"decisions":%s,"review_loop_log":%s,"review_loop_state":%s}' \
  "$(artifact_bool plan.md)" \
  "$(artifact_bool decisions.md)" \
  "$(artifact_bool review-loop.log)" \
  "$(artifact_bool review-loop-state.json)")

# --- review-loop position (sibling object; artifacts{} stays all-boolean) ---
RL_STATE="$SHIPITDIR/review-loop-state.json"
rl_phase='null' rl_mtime='null' rl_outcome=''
loop_name=$(workflow_field "$WORKFLOW" 'Review loop')
if [ -f "$RL_STATE" ]; then
  command -v jq > /dev/null 2>&1 || die 'jq not found — required to read review-loop-state.json'
  # if/fi rather than `&&`: under `set -e` a trailing failed `&&` list exits.
  v=$(jq -r '.phase // empty' "$RL_STATE" 2>/dev/null || true)
  if [ -n "$v" ]; then rl_phase="\"$(jesc "$v")\""; fi
  if [ "$loop_name" = 'none' ]; then
    rl_outcome='skipped'
  elif [ "$v" != 'done' ]; then
    rl_outcome='running'
  else
    rl_outcome=$(jq -r '.outcome // empty' "$RL_STATE" 2>/dev/null || true)
  fi
  # GNU stat first, then BSD/macOS; both give mtime as epoch seconds.
  v=$(stat -c '%Y' "$RL_STATE" 2>/dev/null || stat -f '%m' "$RL_STATE" 2>/dev/null || true)
  case "$v" in
    '' | *[!0-9]*) : ;;
    *)
      v=$(date -u -d "@$v" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$v" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true)
      if [ -n "$v" ]; then rl_mtime="\"$(jesc "$v")\""; fi
      ;;
  esac
elif [ "$loop_name" = 'none' ]; then
  rl_outcome='skipped'
elif [ -n "$loop_name" ]; then
  rl_outcome='pending'
fi
if [ -n "$rl_outcome" ]; then rl_outcome="\"$(jesc "$rl_outcome")\""; else rl_outcome='null'; fi
review_loop_json=$(printf '{"phase":%s,"outcome":%s,"state_mtime":%s}' \
  "$rl_phase" "$rl_outcome" "$rl_mtime")

# --- events ---
events_json='' esc_json='' esep='' ssep=''
for f in "$SHIPITDIR"/events/*.md; do
  base=$(basename -- "$f")
  kind=$(event_kind "$base")
  classified='false'; devround='false'; resolved='false'
  # if/fi rather than `&&`: under `set -e` a trailing failed `&&` list exits.
  if grep -q '^## Reviewer classification' "$f"; then classified='true'; fi
  if grep -q '^## Developer round' "$f"; then devround='true'; fi
  if grep -q '^## Resolution' "$f"; then resolved='true'; fi
  fixes=$(count_fix_findings "$f")
  events_json="${events_json}${esep}{\"file\":\"$(jesc "$base")\",\"kind\":\"$(jesc "$kind")\",\"classified\":${classified},\"fix_findings\":${fixes},\"has_developer_round\":${devround},\"resolved\":${resolved}}"
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

printf '{"branch":"%s","status":"%s","pr_url":"%s","started":"%s","shipitdir":"%s","workflow":"%s","current_stage":%s,"review_rounds":%s,"stages":[%s],"open_escalations":[%s],"artifacts":%s,"review_loop":%s,"events":[%s],"annotations":[%s]}\n' \
  "$(jesc "$BRANCH")" "$(jesc "$STATUS")" "$(jesc "$PR_URL")" "$(jesc "$STARTED")" \
  "$(jesc "$SHIPITDIR")" "$(jesc "$WORKFLOW")" \
  "$current_stage" "$review_rounds" \
  "$stages_json" "$esc_json" "$artifacts_json" "$review_loop_json" "$events_json" "$annot_json"
