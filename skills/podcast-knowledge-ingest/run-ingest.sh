#!/bin/bash
# Entry point for the podcast-knowledge-ingest cron.
# Rust port (services/podcast-ingest, binary: podcast-ingest): the pipeline
# no longer needs a python3-capability probe — the binary is self-contained
# (no interpreter, no site-packages) and just needs to be on PATH.

set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${1:-${SKILL_DIR}/podcasts.yaml}"

BIN="$(command -v podcast-ingest || true)"
if [ -z "$BIN" ]; then
    echo "run-ingest.sh: podcast-ingest not found on PATH — aborting" >&2
    exit 1
fi

exec "$BIN" --config "$CONFIG" "${@:2}"
