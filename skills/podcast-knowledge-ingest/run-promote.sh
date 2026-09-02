#!/bin/bash
# Entry point for the weekly promotion cron (mirrors run-ingest.sh's
# capability-probed interpreter resolution — no /usr/bin/python3 in the image).
set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PY=""
IFS=: read -ra DIRS <<< "$PATH"
for d in "${DIRS[@]}"; do
    cand="$d/python3"
    if [ -x "$cand" ] && "$cand" -c 'import requests' 2>/dev/null; then
        PY="$cand"
        break
    fi
done

if [ -z "$PY" ]; then
    echo "run-promote.sh: no python3 on PATH with requests — aborting" >&2
    exit 1
fi

# ADR-2028: the corpus paths come from the [vault] path authority the entrypoint
# exported. No hard-coded graph path — with no vault configured this aborts
# loudly rather than promoting into a stale or non-existent tree (D3).
if [ -z "${VAULT_ROOT:-}" ] || [ -z "${VAULT_PAGES:-}" ]; then
    echo "run-promote.sh: [vault] disabled — VAULT_ROOT/VAULT_PAGES unset; set [vault].root in agentbox.toml. Aborting." >&2
    exit 1
fi

unset PYTHONPATH
exec "$PY" "${SKILL_DIR}/promote.py" \
    --pages-dir "${VAULT_PAGES}" \
    --proposals-dir "${SKILL_DIR}/promotions/proposals" \
    --working-graph-dir "${VAULT_ROOT}/workingGraph/pages" \
    --limit 15 "$@"
