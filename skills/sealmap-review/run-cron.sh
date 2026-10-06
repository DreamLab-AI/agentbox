#!/usr/bin/env bash
# [program:diagram-review-cron] entry point (ADR-2131).
#
# Renders skills/sealmap-review/crontab from the manifest and execs supercronic on it:
#   run-cron.sh <supercronic-binary>
#
# The schedules and weekly_window are read at boot with `agentbox-manifest`, so a schedule
# edit needs a restart, not an image rebuild. The rendered crontab goes to /run/agentbox
# (tmpfs); no store path is written to any persistent file. Fail-open: an unreadable manifest
# or a malformed cron expression falls back to the shipped default and says so on stderr.
set -u

SUPERCRONIC="${1:-supercronic}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${DIAGRAM_REVIEW_CRONTAB_TEMPLATE:-$HERE/crontab}"
MANIFEST="${AGENTBOX_CONFIG:-/etc/agentbox.toml}"
OUT_DIR="${DIAGRAM_REVIEW_CRONTAB_DIR:-/run/agentbox}"

DEFAULT_TRIAGE='17 5 * * *'
DEFAULT_REVIEW='47 2 * * *'

manifest_string() {
  agentbox-manifest toml-string --manifest "$MANIFEST" --path "$1" 2>/dev/null || true
}
manifest_bool() {
  agentbox-manifest toml-bool --manifest "$MANIFEST" --path "$1" 2>/dev/null || echo 1
}

# A cron expression is five space-separated fields of cron characters and nothing else, so it
# can be substituted into the template without any quoting or injection concern.
valid_cron() {
  [[ "$1" =~ ^[0-9A-Za-z*/,?-]+(\ [0-9A-Za-z*/,?-]+){4}$ ]]
}

pick_cron() { # <manifest key> <default> <label>
  local v
  v="$(manifest_string "diagram_review.$1")"
  if [ -z "$v" ]; then printf '%s' "$2"; return; fi
  if valid_cron "$v"; then printf '%s' "$v"; return; fi
  echo "diagram-review-cron: diagram_review.$1 is not a five-field cron expression; using '$2'" >&2
  printf '%s' "$2"
}

TRIAGE="$(pick_cron glm_triage_cron "$DEFAULT_TRIAGE")"
REVIEW="$(pick_cron glm_review_cron "$DEFAULT_REVIEW")"
WINDOW="$(manifest_bool diagram_review.weekly_window)"

AUDIT_AFTER_TRIAGE=''
if [ "$WINDOW" = "0" ]; then
  AUDIT_AFTER_TRIAGE=" ; node $HERE/scripts/review-cadence.cjs audit-gemini 2>&1"
fi

if [ ! -r "$TEMPLATE" ]; then
  echo "diagram-review-cron: crontab template $TEMPLATE is unreadable" >&2
  exit 1
fi
mkdir -p "$OUT_DIR" 2>/dev/null || OUT_DIR="$(mktemp -d)"
OUT="$OUT_DIR/diagram-review.crontab"

body="$(<"$TEMPLATE")"
body="${body//@GLM_TRIAGE_CRON@/$TRIAGE}"
body="${body//@GLM_REVIEW_CRON@/$REVIEW}"
body="${body//@TRIAGE_AUDIT@/$AUDIT_AFTER_TRIAGE}"
printf '%s\n' "$body" >"$OUT"

echo "diagram-review-cron: triage '$TRIAGE', review '$REVIEW', weekly_window=$WINDOW" >&2
exec "$SUPERCRONIC" -split-logs "$OUT"
