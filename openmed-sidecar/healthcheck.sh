#!/usr/bin/env bash
# Healthy when the redaction server answers on the configured port.
set -uo pipefail
PORT="${OPENMED_PORT:-9093}"
curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && exit 0
echo "openmed not responding on :${PORT}"; exit 1
