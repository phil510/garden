#!/usr/bin/env bash
# Resolve a Claude Code session name or id to its peer-messaging address.
#
# ~/.claude/sessions/<pid>.json is the registry Claude Code keeps for live
# sessions; it states the id<->name pair outright. Read it rather than inferring
# from transcripts: a name's suffix is a random disambiguator, so it cannot be
# computed from the session id.
set -uo pipefail

REGISTRY="$HOME/.claude/sessions"
PROJECTS="$HOME/.claude/projects"

usage() {
  cat >&2 <<'USAGE'
usage: resolve_session.sh [<name-or-id>] [--json]

  <name-or-id>  session name, session id, or id prefix. Omit to list all.
  --json        emit JSON instead of a field block

exit: 0 resolved and reachable   1 not found   2 ambiguous
      3 resolved but NOT reachable (process gone, or no messaging socket)
      64 bad usage   69 jq not installed

--json always emits a JSON array of session records, whatever the outcome.
USAGE
}

query=""
as_json=0
for arg in "$@"; do
  case "$arg" in
    --json) as_json=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; usage; exit 64 ;;
    *)
      if [ -n "$query" ]; then
        echo "expected one name-or-id, got extra argument: $arg" >&2
        usage; exit 64
      fi
      query="$arg" ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "resolve_session.sh requires jq" >&2; exit 69; }

shopt -s nullglob
registry_files=("$REGISTRY"/*.json)
shopt -u nullglob
if [ ${#registry_files[@]} -eq 0 ]; then
  echo "Registry $REGISTRY is empty or unreadable — no live sessions." >&2
  exit 1
fi

# A session that is mid-startup can leave a half-written registry file, and
# `jq -s` aborts the whole slurp on one parse error. Try the cheap bulk read,
# then fall back to per-file reads so one bad file costs one session, not all.
entries=$(jq -s -c '.' "${registry_files[@]}" 2>/dev/null)
if [ -z "$entries" ]; then
  entries=$(for f in "${registry_files[@]}"; do jq -c '.' "$f" 2>/dev/null; done | jq -s -c '.')
fi
if [ -z "$entries" ] || [ "$(jq 'length' <<<"$entries")" -eq 0 ]; then
  echo "No readable session registry entries in $REGISTRY." >&2
  exit 1
fi

# Match name/id exact before prefix and substring, so an exact hit is never
# reported as ambiguous even when it is also a substring of other names.
query_lc=$(printf '%s' "$query" | tr '[:upper:]' '[:lower:]')
matched=$(jq --arg q "$query_lc" '
  def lc: ascii_downcase;
  map(select(type == "object" and has("sessionId") and has("name"))) as $all
  | if $q == "" then $all | map(. + {matchedBy: "list"})
    else
      # Report HOW the match was made. A unique substring resolves confidently
      # but is still a guess at intent, and the caller should be able to see
      # that it was one. Substrings under 3 chars are too loose to be intent.
      [ {by: "exact-name",     rows: ($all | map(select((.name|lc) == $q)))},
        {by: "exact-id",       rows: ($all | map(select((.sessionId|lc) == $q)))},
        {by: "id-prefix",      rows: ($all | map(select((.sessionId|lc) | startswith($q))))},
        {by: "name-substring", rows: (if ($q|length) >= 3
                                      then ($all | map(select((.name|lc) | contains($q))))
                                      else [] end)} ]
      | (map(select(.rows | length > 0)) | .[0]) as $hit
      | ($hit.rows // []) | map(. + {matchedBy: ($hit.by // null)})
    end
  | map({name, sessionId, cwd, status, kind, nameSource, pid,
         startedAt, messagingSocketPath, matchedBy})
' <<<"$entries" 2>/dev/null)

if [ -z "$matched" ]; then
  echo "Could not match against the session registry at $REGISTRY." >&2
  exit 1
fi

# Liveness and transcript are filesystem facts the registry does not carry: a
# registry entry can outlive its process, and that entry is not addressable.
# Start age is shown because ListAgents prints "started N ago" and that is the
# only join between a registry record and the [ref] ListAgents assigns.
enrich() {
  jq -c '.[]' <<<"$1" | while IFS= read -r row; do
    pid=$(jq -r '.pid // empty' <<<"$row")
    sid=$(jq -r '.sessionId' <<<"$row")
    # ps sees processes this user cannot signal; kill -0 reports those as dead.
    alive=false
    if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then alive=true; fi
    # The registry states the socket path. Only compute it if the field is absent.
    sock=$(jq -r '.messagingSocketPath // empty' <<<"$row")
    if [ -z "$sock" ] && [ -n "$pid" ]; then sock="/tmp/cc-socks/${pid}.sock"; fi
    sock_present=false
    [ -n "$sock" ] && [ -S "$sock" ] && sock_present=true
    transcript=""
    for candidate in "$PROJECTS"/*/"$sid.jsonl"; do
      [ -f "$candidate" ] && { transcript="$candidate"; break; }
    done
    jq -c --argjson alive "$alive" --argjson sock "$sock_present" \
          --arg transcript "$transcript" \
      'def age: if . < 3600 then "\(./60|floor)m" elif . < 86400 then "\(./3600|floor)h"
                 else "\(./86400|floor)d" end;
       . + {alive: $alive, socketPresent: $sock,
            started: (if .startedAt then ((now - .startedAt/1000) | age) else null end),
            transcript: (if $transcript == "" then null else $transcript end),
            addressable: ($alive and $sock)}' <<<"$row"
  done
}

count=$(jq 'length' <<<"$matched")
records=$(enrich "$matched" | jq -s 'sort_by(.cwd, .name)')

live_names() { jq -r 'map(.name) | sort | join(", ")' <<<"$matched"; }

# ---- no query: list everything ----
if [ -z "$query" ]; then
  if [ "$as_json" -eq 1 ]; then
    echo "$records"
  else
    jq -r 'def pad($s; $n): $s + (" " * ([$n - ($s|length), 1] | max));
         .[] | (if .addressable then " " else "!" end) + " " +
           pad(.name; 34) + " " +
           pad(.status // "?"; 8) + " " +
           pad(.started // "?"; 5) + " " +
           .sessionId + "  " + (.cwd // "?")' <<<"$records"
  fi
  exit 0
fi

# ---- not found: a registry miss on an id has two distinct meanings ----
if [ "$count" -eq 0 ]; then
  if [[ "${query//-/}" =~ ^[0-9a-fA-F]{8,}$ ]]; then
    found=""
    for candidate in "$PROJECTS"/*/"$query"*.jsonl; do
      [ -f "$candidate" ] && { found="$candidate"; break; }
    done
    if [ -n "$found" ]; then
      echo "Session $query has a transcript ($found) but no registry entry," >&2
      echo "which means the session has exited. It cannot be messaged." >&2
    else
      echo "No session or transcript matches $query. The id is wrong, or it" >&2
      echo "belongs to a different machine." >&2
    fi
  else
    echo "No live session's name matches '$query'." >&2
  fi
  all=$(jq 'map(select(type == "object" and has("sessionId") and has("name")))' <<<"$entries")
  echo >&2
  echo "$(jq 'length' <<<"$all") live sessions: $(jq -r 'map(.name)|sort|join(", ")' <<<"$all")" >&2
  exit 1
fi

# ---- ambiguous: report candidates, never pick one ----
if [ "$count" -gt 1 ]; then
  echo "'$query' matches $count sessions:" >&2
  jq -r 'def pad($s; $n): $s + (" " * ([$n - ($s|length), 1] | max));
         .[] | "  " + pad(.name; 34) + " " + pad(.started // "?"; 5) + " " + .sessionId + "  " + (.cwd // "?")' <<<"$records" >&2
  echo >&2
  echo "Narrow the query, or use the full session id." >&2
  [ "$as_json" -eq 1 ] && echo "$records"
  exit 2
fi

# ---- resolved ----
if [ "$as_json" -eq 1 ]; then
  echo "$records"
else
  jq -r '.[0] |
    (if .addressable then ""
     elif (.alive | not) then "  (NOT addressable — process gone)"
     else "  (NOT addressable — no messaging socket)" end) as $flag |
    "name:        " + .name + $flag,
    "sessionId:   " + .sessionId,
    "cwd:         " + (.cwd // "?"),
    "status:      " + (.status // "?") + "  (" + (.kind // "?") + ", pid " + (.pid|tostring) + ")",
    "started:     " + (.started // "?") + " ago",
    "transcript:  " + (.transcript // "(none found)"),
    (if .matchedBy == "name-substring"
     then "matched:     by name substring, not an exact name or id — confirm this is the intended session"
     else empty end)' <<<"$records"
fi

if [ "$(jq -r '.[0].addressable' <<<"$records")" != "true" ]; then
  exit 3
fi
