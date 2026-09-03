#!/bin/bash
# Entry point for the weekly promotion cron.
# Rust port (services/podcast-ingest, binary: podcast-promote): no longer
# needs a python3-capability probe — the binary is self-contained and just
# needs to be on PATH.
set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BIN="$(command -v podcast-promote || true)"
if [ -z "$BIN" ]; then
    echo "run-promote.sh: podcast-promote not found on PATH — aborting" >&2
    exit 1
fi

# ADR-2028: the corpus paths come from the [vault] path authority the entrypoint
# exported. No hard-coded graph path — with no vault configured this aborts
# loudly rather than promoting into a stale or non-existent tree (D3).
if [ -z "${VAULT_ROOT:-}" ] || [ -z "${VAULT_PAGES:-}" ] || [ -z "${VAULT_WORKING_PAGES:-}" ]; then
    echo "run-promote.sh: [vault] disabled — VAULT_ROOT/VAULT_PAGES/VAULT_WORKING_PAGES unset; set [vault].root and [vault].working in agentbox.toml. Aborting." >&2
    exit 1
fi

exec "$BIN" \
    --pages-dir "${VAULT_PAGES}" \
    --proposals-dir "${SKILL_DIR}/promotions/proposals" \
    --working-graph-dir "${VAULT_WORKING_PAGES}" \
    --limit 15 "$@"
