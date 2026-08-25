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

unset PYTHONPATH
exec "$PY" "${SKILL_DIR}/promote.py" \
    --pages-dir /home/devuser/workspace/logseq/mainKnowledgeGraph/pages \
    --proposals-dir "${SKILL_DIR}/promotions/proposals" \
    --working-graph-dir /home/devuser/workspace/logseq/workingGraph/pages \
    --limit 15 "$@"
