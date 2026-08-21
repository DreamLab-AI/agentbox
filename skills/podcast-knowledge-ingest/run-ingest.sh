#!/bin/bash
# Entry point for the podcast-knowledge-ingest cron.
# The agentbox image is Nix-based: there is no /usr/bin/python3, and the first
# python3 on PATH is the bare interpreter without pyyaml/requests/yt-dlp.
# Resolve the first python3 on PATH that can import the pipeline's deps, so the
# job survives Nix store-path churn across image rebuilds.

set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${1:-${SKILL_DIR}/podcasts.yaml}"

PY=""
IFS=: read -ra DIRS <<< "$PATH"
for d in "${DIRS[@]}"; do
    cand="$d/python3"
    if [ -x "$cand" ] && "$cand" -c 'import yaml, requests' 2>/dev/null; then
        PY="$cand"
        break
    fi
done

if [ -z "$PY" ]; then
    echo "run-ingest.sh: no python3 on PATH with yaml+requests — aborting" >&2
    exit 1
fi

unset PYTHONPATH
exec "$PY" "${SKILL_DIR}/ingest.py" --config "$CONFIG" "${@:2}"
